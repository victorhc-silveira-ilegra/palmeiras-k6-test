#!/usr/bin/env python3
"""Executa um cenário de HML e preserva um manifesto sem credenciais."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import uuid
from zoneinfo import ZoneInfo

from hml_context import Aws, ROOT, UTC, discover, sanitize

SCENARIOS = {
    path.stem for path in (ROOT / "src/presentation/scenarios").glob("*.ts")
    if not path.name.startswith("_")
}


def run(args, topology, manifest, save):
    extra = args.k6_args
    if extra[:1] == ["--"]:
        extra = extra[1:]
    target = args.target
    route = target
    url = args.target_url
    ip = ""
    if target == "hml_classic_elb" and topology["mode"] != "legacy":
        raise ValueError("O Classic ELB exige HML_TOPOLOGY=legacy.")
    if target == "hml_alb":
        if url:
            raise ValueError("O acesso ao ALB usa o destino validado pela descoberta.")
        if topology["mode"] == "current":
            addresses = socket.getaddrinfo(topology["alb"]["DNSName"], 443, socket.AF_INET)
            ip = addresses[0][4][0]
            url = "https://" + topology["hostname"]
            route = "hml_multi_proxy"
        else:
            url = "http://" + topology["alb"]["DNSName"]
    supplied = {}
    for index, arg in enumerate(extra[:-1]):
        if arg == "-e" and "=" in extra[index + 1]:
            key, value = extra[index + 1].split("=", 1)
            if key in ("SMOKE_PROFILE", "REQUEST_TIMEOUT"):
                supplied[key] = value
    manifest["profile"] = supplied.get("SMOKE_PROFILE", "functional") if args.scenario == "smoke" else None
    manifest["request_timeout"] = supplied.get("REQUEST_TIMEOUT") or (
        "3s" if manifest["profile"] == "strict" else "15s" if args.scenario == "smoke" else "310s"
    )
    manifest["executor"] = "docker" if getattr(args, "docker", False) else "native"
    manifest["path"] = route
    manifest["target_url"] = sanitize(url)
    manifest["started_at_utc"] = dt.datetime.now(UTC).isoformat()
    manifest["started_at_brt"] = dt.datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat()
    save()
    values = {
        "TARGET_ENV": target, "TARGET_URL": url, "HML_ALB_IP": ip,
        "SMOKE_MULTI_PROXY_IP": "", "HML_RUN_ID": manifest["run_id"],
        "HML_ROUTE": route, "HML_TOPOLOGY": topology["mode"],
        "HML_RUN_STARTED_AT": manifest["started_at_utc"],
    }
    params = list(extra)
    for key, value in values.items():
        params.extend(["-e", f"{key}={value}"])
    if target in ("hml_ec2_direct", "ec2_direct") and not url:
        from ec2_smoke import run_tunnel_smoke
        def record_host(instance):
            manifest["selected_instance"] = instance
            save()
        def execute(binary, tunnel_url, forwarded, scenario):
            forwarded = [*forwarded, "-e", "TARGET_URL=" + tunnel_url,
                         "-e", "HML_ALB_IP=", "-e", "SMOKE_MULTI_PROXY_IP="]
            return invoke(args, forwarded)
        return run_tunnel_smoke(args.k6, params, args.scenario, topology, record_host, execute)
    return invoke(args, params)


def invoke(args, params):
    prefix = [args.k6]
    if getattr(args, "docker", False):
        prefix = [
            "docker", "compose", "--env-file", str(ROOT / ".env"),
            "-f", str(ROOT / "infra/docker/docker-compose.yml"),
            "--project-directory", str(ROOT), "run", "--rm", "palmeiras-k6",
        ]
    return subprocess.run(
        [*prefix, "run", *params, f"src/presentation/scenarios/{args.scenario}.ts"], cwd=ROOT,
    ).returncode


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--k6", default="k6")
    parser.add_argument("--docker", action="store_true")
    parser.add_argument("--scenario", default="smoke")
    parser.add_argument("--target", default="azion_edge", choices=[
        "azion_edge", "hml_alb", "hml_classic_elb", "hml_ec2_direct", "ec2_direct",
    ])
    parser.add_argument("--target-url", default="")
    parser.add_argument("k6_args", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.scenario not in SCENARIOS:
        raise ValueError("Cenário não reconhecido.")
    topology = discover(Aws())
    run_id = str(uuid.uuid4())
    directory = ROOT / "reports" / "runs"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{run_id}.json"
    manifest = {
        "run_id": run_id, "account": topology["account"], "region": topology["region"],
        "topology_mode": topology["mode"], "scenario": args.scenario,
        "alb_arn": topology["alb"]["LoadBalancerArn"],
        "target_group_arn": topology["target_group"]["TargetGroupArn"],
        "instance_ids": [host["InstanceId"] for host in topology["instances"]],
        "status": "running",
        "started_at_utc": dt.datetime.now(UTC).isoformat(),
    }
    def save():
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest, indent=2))
        os.replace(temporary, path)
    result = 1
    try:
        print(f"Rodada {run_id} | cenário {args.scenario} | destino {args.target}", flush=True)
        result = run(args, topology, manifest, save)
        return result
    finally:
        manifest["exit_code"] = result
        manifest["status"] = "passed" if result == 0 else "failed"
        manifest["finished_at_utc"] = dt.datetime.now(UTC).isoformat()
        manifest["finished_at_brt"] = dt.datetime.now(ZoneInfo("America/Sao_Paulo")).isoformat()
        save()
        print("Manifesto da rodada " + str(path), flush=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:
        print("Execução HML interrompida: " + sanitize(str(exc)), file=sys.stderr)
        sys.exit(1)
