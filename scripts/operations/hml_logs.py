"""Leitura e correlação temporal dos registros existentes de HML."""

from __future__ import annotations

import csv
import datetime as dt
import gzip
import json
from pathlib import Path
import re
import shlex
import subprocess

from hml_context import route, sanitize, source, timestamp


def overlaps_delivery(key: str, start: dt.datetime, end: dt.datetime) -> bool:
    match = re.search(r"_(\d{8}T\d{4}Z)_", key)
    if not match:
        return False
    delivery = dt.datetime.strptime(match[1], "%Y%m%dT%H%MZ").replace(tzinfo=dt.timezone.utc)
    return start <= delivery <= end + dt.timedelta(minutes=30)


def parse_alb(line: str, start: dt.datetime, end: dt.datetime) -> dict | None:
    try:
        fields = shlex.split(line)
    except ValueError:
        return None
    if len(fields) < 14:
        return None
    try:
        observed = timestamp(fields[1])
    except ValueError:
        return None
    if not start <= observed <= end:
        return None
    request = fields[12].split()
    if len(request) < 2:
        return None
    return {
        "timestamp": observed.isoformat(), "method": request[0],
        "path": route(request[1]), "target": sanitize(fields[4]),
        "alb_status": fields[8], "target_status": fields[9],
        "request_seconds": fields[5], "target_seconds": fields[6],
        "response_seconds": fields[7],
    }


def alb_logs(client, topology: dict, start: dt.datetime, end: dt.datetime) -> dict:
    def fetch():
        attributes = {
            item["Key"]: item["Value"] for item in client.call(
                "elbv2", "describe-load-balancer-attributes",
                load_balancer_arn=topology["alb"]["LoadBalancerArn"],
            )["Attributes"]
        }
        if attributes.get("access_logs.s3.enabled") != "true":
            return {"enabled": False, "records": [], "coverage": "unavailable"}
        bucket = attributes["access_logs.s3.bucket"]
        prefix = attributes.get("access_logs.s3.prefix", "").strip("/")
        base = "/".join(filter(None, [
            prefix, "AWSLogs", topology["account"], "elasticloadbalancing", topology["region"],
        ]))
        marker = topology["alb"]["LoadBalancerArn"].split("loadbalancer/")[1].replace("/", ".")
        keys = []
        day = start.date()
        while day <= (end + dt.timedelta(minutes=30)).date():
            token = None
            while True:
                params = {"bucket": bucket, "prefix": f"{base}/{day:%Y/%m/%d}/"}
                if token:
                    params["continuation_token"] = token
                page = client.call("s3api", "list-objects-v2", **params)
                keys.extend(
                    item["Key"] for item in page.get("Contents", [])
                    if marker in item["Key"] and "/conn_log_" not in item["Key"]
                    and "/health_check_log_" not in item["Key"]
                    and overlaps_delivery(item["Key"], start, end)
                )
                token = page.get("NextContinuationToken")
                if not token:
                    break
            day += dt.timedelta(days=1)
        records = []
        for key in sorted(set(keys)):
            process = subprocess.Popen(
                client.command("s3", "cp", f"s3://{bucket}/{key}", "-", "--only-show-errors"),
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            )
            try:
                with gzip.GzipFile(fileobj=process.stdout) as archive:
                    for raw in archive:
                        parsed = parse_alb(raw.decode("utf-8", errors="replace"), start, end)
                        if parsed:
                            records.append(parsed)
                if process.wait(timeout=60):
                    raise RuntimeError("Falha ao ler objeto de log do ALB.")
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)
        return {
            "enabled": True, "objects_read": len(keys), "records": records,
            "coverage": "best_effort" if keys else "delivery_pending",
            "note": "Ausência de registros não comprova ausência de tentativas de conexão.",
        }
    result = source(fetch)
    if result["status"] == "ok":
        data = result["data"]
        if not data["enabled"]:
            result["status"] = "unavailable"
        elif not data["records"]:
            result["status"] = "no_data"
    return result


def cloudwatch_logs(client, topology: dict, start: dt.datetime, end: dt.datetime) -> dict:
    result = {}
    group = "/palmeiras/hml/nginx/error"
    ids = [host["InstanceId"] for host in topology["instances"]]

    def nginx():
        streams = list(client.pages(
            "logs", "describe-log-streams", "logStreams", log_group_name=group,
        ))
        names = [item["logStreamName"] for item in streams
                 if any(host in item["logStreamName"] for host in ids)]
        if not names:
            return []
        events = []
        for offset in range(0, len(names), 100):
            events.extend(client.pages(
                "logs", "filter-log-events", "events", log_group_name=group,
                log_stream_names=names[offset:offset + 100],
                start_time=int(start.timestamp() * 1000),
                end_time=int(end.timestamp() * 1000),
            ))
        return [{"timestamp": item["timestamp"], "message": sanitize(item["message"])}
                for item in events]
    result["nginx_current_instances"] = source(nginx)
    for category in ("error", "slowquery"):
        def rds(category=category):
            events = list(client.pages(
                "logs", "filter-log-events", "events",
                log_group_name=f"/aws/rds/cluster/{topology['rds_cluster']}/{category}",
                start_time=int(start.timestamp() * 1000),
                end_time=int(end.timestamp() * 1000),
            ))
            return {
                "events_observed": len(events), "scope": "shared_cluster_context",
                "attributed_to_run": False,
                "note": "Eventos de banco exigem vínculo com banco, origem e requisição.",
            }
        result["rds_" + category] = source(rds)
    return result


def azion_logs(filename: str | None, start: dt.datetime, end: dt.datetime, alb: dict) -> dict:
    if not filename:
        return {"status": "unavailable", "note": "Aguardando logs da equipe Azion."}
    path = Path(filename)
    with path.open() as stream:
        if path.suffix.lower() == ".csv":
            rows = list(csv.DictReader(stream))
        else:
            payload = json.load(stream)
            rows = payload if isinstance(payload, list) else payload.get("records", [])
    records = []
    alb_records = alb.get("data", {}).get("records", [])
    for item in rows:
        if not item.get("timestamp"):
            continue
        observed = timestamp(item["timestamp"])
        if not start <= observed <= end:
            continue
        normalized = {
            "timestamp": observed.isoformat(),
            "method": str(item.get("method", "GET")),
            "path": route(str(item.get("path", item.get("url", "")))),
            "origin": sanitize(str(item.get("origin", ""))),
            "status": str(item.get("status", "")),
            "connection_result": sanitize(str(item.get("connection_result", ""))),
            "request_id": sanitize(str(item.get("request_id", ""))),
        }
        candidates = [
            entry for entry in alb_records
            if entry["path"] == normalized["path"] and entry["method"] == normalized["method"]
            and abs((timestamp(entry["timestamp"]) - observed).total_seconds()) <= 5
        ]
        normalized["alb_candidate_count"] = len(candidates)
        normalized["association"] = "pending"
        records.append(normalized)
    return {"status": "ok" if records else "no_data", "data": records,
            "note": "Candidatos temporais exigem confirmação pelo identificador da borda."}
