#!/usr/bin/env python3
"""
Sentinel Watcher - Palmeiras HML CloudWatch & Telemetry Stream Monitor.
Monitors ALB Azion, Classic ELB, RDS Aurora, and reports/live_telemetry_stream.log.
Exits immediately if an anomaly or 504 is detected, or completes a surveillance round.
"""

from __future__ import annotations

import datetime
import re
import os
import subprocess
import sys
import time
from typing import Any, Dict, List


def load_aws_credentials_if_needed() -> None:
    if os.getenv("AWS_ACCESS_KEY_ID") and os.getenv("AWS_SECRET_ACCESS_KEY"):
        return
    try:
        res = subprocess.run(
            ["aws", "configure", "export-credentials", "--format", "env"],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0 and res.stdout:
            for line in res.stdout.splitlines():
                if line.startswith("export "):
                    key, _, val = line.replace("export ", "").partition("=")
                    os.environ[key.strip()] = val.strip()
    except Exception:
        pass


load_aws_credentials_if_needed()

try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("[ERRO] boto3 nao instalado.")
    sys.exit(1)

HML_INSTANCE_ID = "i-02b29195a2fdaf1e7"
HML_ALB_DIM = "app/Hml-Site-Azion/ffb14ee37a74405d"
HML_ELB_NAME = "dev-sep-hml"
HML_RDS_CLUSTER = "db-sep-1"
STREAM_LOG = "reports/live_telemetry_stream.log"


def get_cw_metric(
    cw,
    namespace: str,
    metric_name: str,
    dimensions: List[Dict[str, str]],
    stat: str,
    minutes: int = 3,
) -> float:
    try:
        now = datetime.datetime.now(datetime.timezone.utc)
        resp = cw.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=dimensions,
            StartTime=now - datetime.timedelta(minutes=minutes),
            EndTime=now,
            Period=60,
            Statistics=[stat],
        )
        pts = resp.get("Datapoints", [])
        if not pts:
            return 0.0
        pts.sort(key=lambda x: x["Timestamp"])
        if stat == "Sum":
            return float(sum(p.get("Sum", 0.0) for p in pts))
        return float(pts[-1].get(stat, 0.0))
    except Exception as e:
        print(f"[CW ERROR {metric_name}]: {e}")
        return 0.0


def check_stream_log(last_pos: int) -> tuple[int, list[str]]:
    if not os.path.exists(STREAM_LOG):
        return last_pos, []
    with open(STREAM_LOG, "r", encoding="utf-8", errors="replace") as f:
        f.seek(last_pos)
        new_lines = f.readlines()
        new_pos = f.tell()
    return new_pos, new_lines


def run_surveillance(rounds: int = 4, interval: int = 10) -> None:
    cfg = Config(connect_timeout=4, read_timeout=8, retries={"max_attempts": 2})
    cw = boto3.client("cloudwatch", region_name="us-east-1", config=cfg)

    last_stream_pos = 0
    if os.path.exists(STREAM_LOG):
        last_stream_pos = os.path.getsize(STREAM_LOG)

    print(f"[{datetime.datetime.now(datetime.timezone.utc).isoformat()}] Sentinel surveillance iniciada ({rounds} rounds x {interval}s)...")

    for round_idx in range(1, rounds + 1):
        time.sleep(interval)
        now_ts = datetime.datetime.now(datetime.timezone.utc).strftime("%H:%M:%S")

        # 1. Checa stream log
        last_stream_pos, new_lines = check_stream_log(last_stream_pos)
        anomaly_detected = False
        anomaly_reasons = []

        for line in new_lines:
            l_strip = line.strip()
            # Verifica alertas reais: 504!=0, nginx timeout, alerta explícito
            if "[ALERTA" in l_strip:
                anomaly_detected = True
                anomaly_reasons.append(f"Log Stream Alerta: {l_strip}")
            elif re.search(r"504\s*=\s*[1-9]", l_strip):
                anomaly_detected = True
                anomaly_reasons.append(f"Log Stream 504 Count: {l_strip}")
            elif any(term in l_strip.lower() for term in ["upstream timed out", "connection timed out", "slowquery", "[nginx error timeout]"]):
                anomaly_detected = True
                anomaly_reasons.append(f"Log Stream Timeout/Error: {l_strip}")

        # 2. Métricas ALB Azion
        alb_504 = get_cw_metric(cw, "AWS/ApplicationELB", "HTTPCode_ELB_504_Count", [{"Name": "LoadBalancer", "Value": HML_ALB_DIM}], "Sum")
        alb_5xx = get_cw_metric(cw, "AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", [{"Name": "LoadBalancer", "Value": HML_ALB_DIM}], "Sum")
        alb_rt = get_cw_metric(cw, "AWS/ApplicationELB", "TargetResponseTime", [{"Name": "LoadBalancer", "Value": HML_ALB_DIM}], "Average")
        alb_req = get_cw_metric(cw, "AWS/ApplicationELB", "RequestCount", [{"Name": "LoadBalancer", "Value": HML_ALB_DIM}], "Sum")

        # 3. Métricas Classic ELB
        elb_5xx = get_cw_metric(cw, "AWS/ELB", "HTTPCode_Backend_5XX", [{"Name": "LoadBalancerName", "Value": HML_ELB_NAME}], "Sum")
        elb_lat = get_cw_metric(cw, "AWS/ELB", "Latency", [{"Name": "LoadBalancerName", "Value": HML_ELB_NAME}], "Average")

        # 4. Métricas RDS Aurora
        rds_deadlocks = get_cw_metric(cw, "AWS/RDS", "Deadlocks", [{"Name": "DBClusterIdentifier", "Value": HML_RDS_CLUSTER}], "Sum")
        rds_conns = get_cw_metric(cw, "AWS/RDS", "DatabaseConnections", [{"Name": "DBClusterIdentifier", "Value": HML_RDS_CLUSTER}], "Maximum")
        rds_cpu = get_cw_metric(cw, "AWS/RDS", "CPUUtilization", [{"Name": "DBClusterIdentifier", "Value": HML_RDS_CLUSTER}], "Average")

        # 5. Avalia anomalias nas métricas
        if alb_504 > 0:
            anomaly_detected = True
            anomaly_reasons.append(f"ALB HTTPCode_ELB_504_Count = {alb_504}")
        if alb_5xx > 0:
            anomaly_detected = True
            anomaly_reasons.append(f"ALB HTTPCode_Target_5XX_Count = {alb_5xx}")
        if elb_5xx > 0:
            anomaly_detected = True
            anomaly_reasons.append(f"Classic ELB HTTPCode_Backend_5XX = {elb_5xx}")
        if rds_deadlocks > 0:
            anomaly_detected = True
            anomaly_reasons.append(f"RDS Aurora Deadlocks = {rds_deadlocks}")
        if alb_rt > 5.0:
            anomaly_detected = True
            anomaly_reasons.append(f"ALB TargetResponseTime crítico = {alb_rt:.2f}s")
        if elb_lat > 5.0:
            anomaly_detected = True
            anomaly_reasons.append(f"Classic ELB Latency crítica = {elb_lat:.2f}s")
        if rds_cpu > 85.0:
            anomaly_detected = True
            anomaly_reasons.append(f"RDS Aurora CPUUtilization crítica = {rds_cpu:.1f}%")

        summary = (
            f"[{now_ts}] R#{round_idx}: "
            f"ALB(req={alb_req:.0f}, 504={alb_504:.0f}, 5xx={alb_5xx:.0f}, rt={alb_rt:.2f}s) | "
            f"ELB(5xx={elb_5xx:.0f}, lat={elb_lat:.3f}s) | "
            f"RDS(cpu={rds_cpu:.1f}%, conns={rds_conns:.0f}, dlk={rds_deadlocks:.0f})"
        )
        print(summary)

        if anomaly_detected:
            print("\n" + "=" * 60)
            print(f"[ALERTA SENTINELA - ANOMALIA DETECTADA EM {now_ts}]")
            for r in anomaly_reasons:
                print(f" -> {r}")
            print(summary)
            print("=" * 60)
            # Salvar dump de anomalia
            with open("reports/sentinel_anomaly_alert.json", "w", encoding="utf-8") as f:
                json.dump({
                    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    "reasons": anomaly_reasons,
                    "alb": {"504": alb_504, "5xx": alb_5xx, "rt": alb_rt, "req": alb_req},
                    "elb": {"5xx": elb_5xx, "lat": elb_lat},
                    "rds": {"cpu": rds_cpu, "conns": rds_conns, "deadlocks": rds_deadlocks},
                    "recent_stream_lines": new_lines[-10:],
                }, f, indent=2)
            sys.exit(2)

    print(f"[{datetime.datetime.now(datetime.timezone.utc).isoformat()}] Surveillance concluída sem anomalias críticas.")
    sys.exit(0)


if __name__ == "__main__":
    r = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    i = int(sys.argv[2]) if len(sys.argv) > 2 else 10
    run_surveillance(rounds=r, interval=i)
