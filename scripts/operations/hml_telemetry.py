#!/usr/bin/env python3
"""Coleta métricas e logs dos recursos descobertos de HML."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import json
import os
from pathlib import Path
import sys
import time
import uuid

from hml_context import Aws, CONFIG, UTC, discover, historical_topology, sanitize, source, timestamp
from hml_hosts import inspect_host
from hml_logs import alb_logs, cloudwatch_logs


def metric(client, namespace, name, dimensions, statistic, start, end):
    return source(lambda: sorted(client.call(
        "cloudwatch", "get-metric-statistics", namespace=namespace, metric_name=name,
        dimensions=[{"Name": key, "Value": value} for key, value in dimensions.items()],
        start_time=start.isoformat(), end_time=end.isoformat(), period=60,
        statistics=[statistic],
    ).get("Datapoints", []), key=lambda point: point["Timestamp"]))


def collect_metrics(client, topology, start, end):
    alb = {"LoadBalancer": topology["alb"]["LoadBalancerArn"].split("loadbalancer/")[1]}
    specs = [
        ("alb_requests", "AWS/ApplicationELB", "RequestCount", alb, "Sum"),
        ("alb_target_rt", "AWS/ApplicationELB", "TargetResponseTime", alb, "Average"),
        ("alb_elb_504", "AWS/ApplicationELB", "HTTPCode_ELB_504_Count", alb, "Sum"),
        ("alb_target_5xx", "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", alb, "Sum"),
    ]
    for host in topology["instances"]:
        host_id = host["InstanceId"]
        for suffix, namespace, name in [
            ("cpu", "AWS/EC2", "CPUUtilization"),
            ("memory", "CWAgent", "mem_used_percent"),
        ]:
            specs.append((host_id + "_" + suffix, namespace, name, {"InstanceId": host_id}, "Maximum"))
    for name in ("CPUUtilization", "DatabaseConnections", "Deadlocks"):
        specs.append((
            "rds_shared_" + name, "AWS/RDS", name,
            {"DBClusterIdentifier": topology["rds_cluster"]}, "Maximum",
        ))
    def fetch(spec):
        key, namespace, name, dimensions, stat = spec
        if namespace == "CWAgent":
            try:
                metrics = list(client.pages(
                    "cloudwatch", "list-metrics", "Metrics", namespace=namespace,
                    metric_name=name,
                    dimensions=[{"Name": key, "Value": value} for key, value in dimensions.items()],
                ))
                if not metrics:
                    return key, {"status": "no_data", "data": [],
                                 "note": "Métrica não descoberta para esta instância."}
                dimensions = {item["Name"]: item["Value"] for item in metrics[0]["Dimensions"]}
            except Exception as exc:
                return key, {"status": "error", "error": sanitize(str(exc))}
        result = metric(client, namespace, name, dimensions, stat, start, end)
        result["dimensions"] = dimensions
        if key.startswith("rds_shared"):
            result["scope"] = "shared_cluster_context"
            result["attributed_to_run"] = False
        return key, result
    with ThreadPoolExecutor(max_workers=6) as pool:
        return dict(pool.map(fetch, specs))


def collect(client, topology, start, end, include_hosts=True, include_access=True):
    result = {
        "timestamp": dt.datetime.now(UTC).isoformat(),
        "start_utc": start.isoformat(), "end_utc": end.isoformat(),
        "topology": topology,
        "cw_metrics": collect_metrics(client, topology, start, end),
        "cw_logs": cloudwatch_logs(client, topology, start, end),
        "traces": {"status": "unavailable", "note": "Fonte APM ainda não confirmada."},
    }
    if include_access:
        result["alb_access_logs"] = alb_logs(client, topology, start, end)
    if include_hosts:
        ids = [host["InstanceId"] for host in topology["instances"]]
        with ThreadPoolExecutor(max_workers=2) as pool:
            values = pool.map(lambda host: inspect_host(client, topology, host, start, end), ids)
            result["ec2_ssm"] = dict(zip(ids, values))
    return result


def render(result):
    topology = result["topology"]
    print(f"HML {topology['mode']} | ALB {topology['alb']['LoadBalancerName']}")
    print(f"Janela UTC {result['start_utc']} até {result['end_utc']}")
    print("Instâncias " + ", ".join(host["InstanceId"] for host in topology["instances"]))
    for key, value in result["cw_metrics"].items():
        points = value.get("data", [])
        if value["status"] == "ok":
            numbers = [point.get("Sum", point.get("Maximum", point.get("Average"))) for point in points]
            print(f"  {key} = {numbers} ({len(points)} amostras)")
        else:
            print(f"  {key} = {value['status']} {value.get('error', '')}")
    for key in ("cw_logs", "ec2_ssm", "alb_access_logs", "traces"):
        if key in result:
            print(key + " = " + json.dumps(result[key], ensure_ascii=False))


def load_window(run, minutes):
    if minutes <= 0:
        raise ValueError("A janela deve ser positiva.")
    if run:
        manifest = json.loads(Path(run).read_text())
        required = {"run_id", "account", "region", "topology_mode", "instance_ids",
                    "alb_arn", "started_at_utc", "finished_at_utc"}
        if not required.issubset(manifest):
            raise ValueError("Informe o manifesto reports/runs/<UUID>.json produzido pelo controlador.")
        if manifest["account"] != CONFIG["account"]:
            raise ValueError("Manifesto de outra conta.")
        if manifest["region"] != CONFIG["region"]:
            raise ValueError("Manifesto de outra região.")
        uuid.UUID(manifest["run_id"])
        start = timestamp(manifest["started_at_utc"])
        end = timestamp(manifest["finished_at_utc"])
        if end < start:
            raise ValueError("Janela da rodada invertida.")
        return start, end, manifest
    end = dt.datetime.now(UTC)
    return end - dt.timedelta(minutes=minutes), end, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("positional_minutes", nargs="?", type=int)
    parser.add_argument("--minutes", "-m", type=int, default=15)
    parser.add_argument("--region", "-r", default=CONFIG["region"])
    parser.add_argument("--run")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--watch", "-w", action="store_true")
    parser.add_argument("--interval", "-i", type=int, default=5)
    parser.add_argument("--stop-on-504", action="store_true")
    parser.add_argument("--metrics-only", action="store_true")
    parser.add_argument("--legacy", action="store_true")
    args = parser.parse_args()
    minutes = args.minutes if args.positional_minutes is None else args.positional_minutes
    if args.interval <= 0:
        raise ValueError("O intervalo deve ser positivo.")
    if args.watch and args.run:
        raise ValueError("Use --run para a janela histórica ou --watch para acompanhamento ao vivo.")
    start, end, manifest = load_window(args.run, minutes)
    mode = "legacy" if args.legacy else os.getenv("HML_TOPOLOGY", "current")
    if manifest:
        mode = manifest["topology_mode"]
    client = Aws(args.region)
    while True:
        topology = discover(client, mode)
        if manifest:
            if manifest["alb_arn"] != topology["alb"]["LoadBalancerArn"]:
                raise ValueError("ALB do manifesto diverge da descoberta atual.")
            topology = historical_topology(client, manifest, topology)
        if args.watch:
            start, end, _ = load_window(None, minutes)
        if args.metrics_only:
            result = {
                "start_utc": start.isoformat(), "end_utc": end.isoformat(),
                "topology": topology, "cw_metrics": collect_metrics(client, topology, start, end),
            }
        else:
            result = collect(client, topology, start, end,
                             include_hosts=manifest is None, include_access=not args.watch)
            if manifest:
                result["ec2_ssm"] = {"status": "unavailable", "note": "Janela histórica; SSM é usado na coleta atual."}
        if manifest:
            result["run_id"] = manifest["run_id"]
        if args.json:
            print(json.dumps(result, ensure_ascii=False), flush=True)
        else:
            render(result)
        if not args.watch:
            return 0
        output = Path("reports/live_telemetry_stream.log")
        output.parent.mkdir(exist_ok=True)
        with output.open("a") as stream:
            stream.write(json.dumps(result, ensure_ascii=False) + "\n")
        event = result["cw_metrics"]["alb_elb_504"]
        if args.stop_on_504 and event["status"] == "ok" and any(
            point.get("Sum", 0) > 0 for point in event["data"]
        ):
            print("Capturado 504 publicado pelo ALB de HML.")
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("Monitoramento encerrado.")
    except Exception as exc:
        print("Falha na coleta HML: " + sanitize(str(exc)), file=sys.stderr)
        sys.exit(1)
