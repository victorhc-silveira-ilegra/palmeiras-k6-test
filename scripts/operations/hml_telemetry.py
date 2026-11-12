#!/usr/bin/env python3
"""
Orquestrador de Telemetria e Diagnostico Avancado - Palmeiras K6 HML.
Coleta metricas, logs e traces integrados:
1. CloudWatch Metrics (EC2, CWAgent, ALB Azion, Classic ELB, RDS Aurora).
2. CloudWatch Logs (RDS Aurora slowquery/error, Nginx error).
3. Telemetria interna da EC2 via AWS SSM (PHP-FPM, Nginx error/upstream, WordPress debug/hyperdb, sockets RDS).
4. Modo Live Watch interativo para acompanhamento em tempo real durante acoes pesadas do WordPress.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional


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
    print("[ERRO] Biblioteca 'boto3' nao encontrada. Instale com: pip install boto3")
    sys.exit(1)

HML_INSTANCE_ID = "i-02b29195a2fdaf1e7"
HML_ALB_DIM = "app/Hml-Site-Azion/ffb14ee37a74405d"
HML_ELB_NAME = "dev-sep-hml"
HML_RDS_CLUSTER = "db-sep-1"
HML_RDS_INSTANCES = ["db-sep-escritor", "db-sep-leitor"]

COLOR_CYAN = "\033[36m"
COLOR_GREEN = "\033[32m"
COLOR_YELLOW = "\033[33m"
COLOR_RED = "\033[31m"
COLOR_BLUE = "\033[34m"
COLOR_BOLD = "\033[1m"
COLOR_RESET = "\033[0m"


def format_header(title: str) -> str:
    line = "=" * 70
    return f"\n{COLOR_BOLD}{COLOR_BLUE}{line}\n  {title}\n{line}{COLOR_RESET}"


def format_section(title: str) -> str:
    return f"\n{COLOR_BOLD}{COLOR_CYAN}--- {title} ---{COLOR_RESET}"


class HmlTelemetryCollector:
    def __init__(self, region: str = "us-east-1", minutes: int = 15):
        self.region = region
        self.minutes = minutes
        cfg = Config(connect_timeout=5, read_timeout=10, retries={"max_attempts": 2})
        self.cw = boto3.client("cloudwatch", region_name=region, config=cfg)
        self.logs = boto3.client("logs", region_name=region, config=cfg)
        self.ssm = boto3.client("ssm", region_name=region, config=cfg)

        now = datetime.datetime.now(datetime.timezone.utc)
        self.end_time = now
        self.start_time = now - datetime.timedelta(minutes=minutes)

    def fetch_cw_metric(
        self,
        namespace: str,
        metric_name: str,
        dimensions: List[Dict[str, str]],
        stat: str = "Average",
        period: int = 60,
    ) -> List[Dict[str, Any]]:
        try:
            resp = self.cw.get_metric_statistics(
                Namespace=namespace,
                MetricName=metric_name,
                Dimensions=dimensions,
                StartTime=self.start_time,
                EndTime=self.end_time,
                Period=period,
                Statistics=[stat],
            )
            pts = resp.get("Datapoints", [])
            pts.sort(key=lambda p: p["Timestamp"])
            return pts
        except Exception as exc:
            return [{"error": str(exc)}]

    def collect_cloudwatch_metrics(self) -> Dict[str, Any]:
        results: Dict[str, Any] = {}

        # 1. EC2
        dim_ec2 = [{"Name": "InstanceId", "Value": HML_INSTANCE_ID}]
        results["ec2_cpu_avg"] = self.fetch_cw_metric("AWS/EC2", "CPUUtilization", dim_ec2, "Average")
        results["ec2_cpu_max"] = self.fetch_cw_metric("AWS/EC2", "CPUUtilization", dim_ec2, "Maximum")
        results["ec2_mem_used"] = self.fetch_cw_metric("CWAgent", "mem_used_percent", dim_ec2, "Maximum")

        # 2. ALB (Hml-Site-Azion)
        dim_alb = [{"Name": "LoadBalancer", "Value": HML_ALB_DIM}]
        results["alb_requests"] = self.fetch_cw_metric("AWS/ApplicationELB", "RequestCount", dim_alb, "Sum")
        results["alb_target_rt"] = self.fetch_cw_metric("AWS/ApplicationELB", "TargetResponseTime", dim_alb, "Average")
        results["alb_target_5xx"] = self.fetch_cw_metric("AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", dim_alb, "Sum")
        results["alb_elb_504"] = self.fetch_cw_metric("AWS/ApplicationELB", "HTTPCode_ELB_504_Count", dim_alb, "Sum")
        results["alb_elb_5xx"] = self.fetch_cw_metric("AWS/ApplicationELB", "HTTPCode_ELB_5XX_Count", dim_alb, "Sum")

        # 3. Classic ELB (dev-sep-hml)
        dim_elb = [{"Name": "LoadBalancerName", "Value": HML_ELB_NAME}]
        results["elb_requests"] = self.fetch_cw_metric("AWS/ELB", "RequestCount", dim_elb, "Sum")
        results["elb_latency"] = self.fetch_cw_metric("AWS/ELB", "Latency", dim_elb, "Average")
        results["elb_backend_5xx"] = self.fetch_cw_metric("AWS/ELB", "HTTPCode_Backend_5XX", dim_elb, "Sum")
        results["elb_backend_2xx"] = self.fetch_cw_metric("AWS/ELB", "HTTPCode_Backend_2XX", dim_elb, "Sum")

        # 4. RDS Aurora (db-sep-1 cluster & instances)
        dim_cluster = [{"Name": "DBClusterIdentifier", "Value": HML_RDS_CLUSTER}]
        results["rds_cluster_cpu"] = self.fetch_cw_metric("AWS/RDS", "CPUUtilization", dim_cluster, "Average")
        results["rds_cluster_conns"] = self.fetch_cw_metric("AWS/RDS", "DatabaseConnections", dim_cluster, "Maximum")
        results["rds_cluster_deadlocks"] = self.fetch_cw_metric("AWS/RDS", "Deadlocks", dim_cluster, "Sum")

        results["rds_instances"] = {}
        for inst in HML_RDS_INSTANCES:
            dim_inst = [{"Name": "DBInstanceIdentifier", "Value": inst}]
            results["rds_instances"][inst] = {
                "cpu_max": self.fetch_cw_metric("AWS/RDS", "CPUUtilization", dim_inst, "Maximum"),
                "connections": self.fetch_cw_metric("AWS/RDS", "DatabaseConnections", dim_inst, "Maximum"),
                "read_latency": self.fetch_cw_metric("AWS/RDS", "ReadLatency", dim_inst, "Average"),
                "write_latency": self.fetch_cw_metric("AWS/RDS", "WriteLatency", dim_inst, "Average"),
            }

        return results

    def fetch_cw_log_tail(self, log_group: str, limit: int = 15) -> List[str]:
        try:
            start_ms = int(self.start_time.timestamp() * 1000)
            end_ms = int(self.end_time.timestamp() * 1000)
            resp = self.logs.filter_log_events(
                logGroupName=log_group,
                startTime=start_ms,
                endTime=end_ms,
                limit=limit,
                interleaved=True,
            )
            return [ev.get("message", "").strip() for ev in resp.get("events", []) if ev.get("message")]
        except Exception as exc:
            return [f"(Aviso: Nao foi possivel consultar {log_group}: {exc})"]

    def collect_cloudwatch_logs(self) -> Dict[str, List[str]]:
        groups = {
            "rds_slowquery": "/aws/rds/cluster/db-sep-1/slowquery",
            "rds_error": "/aws/rds/cluster/db-sep-1/error",
            "nginx_error": "/palmeiras/hml/nginx/error",
        }
        res: Dict[str, List[str]] = {}
        for key, gname in groups.items():
            res[key] = self.fetch_cw_log_tail(gname, limit=10)
        return res

    def collect_ec2_internal_ssm(self) -> Dict[str, Any]:
        commands = [
            "echo '=== EC2_UPTIME_AND_MEM ==='",
            "uptime; free -h",
            "echo '=== PHP_FPM_STATUS ==='",
            "systemctl status php8.3-fpm --no-pager | head -n 12",
            "echo '=== RDS_AURORA_SOCKETS ==='",
            "ss -tan '( sport = :3306 or dport = :3306 )' | head -n 15",
            "echo '=== NGINX_UPSTREAM_TIMEOUTS ==='",
            "grep -E 'upstream timed out|110: Connection timed out' /var/log/nginx/error.log 2>/dev/null | tail -n 8 || true",
            "echo '=== WORDPRESS_DEBUG_LOG ==='",
            "tail -n 12 /var/www/html/wordpress/wp-content/debug.log 2>/dev/null || true",
            "echo '=== HYPERDB_QUERIES_LOG ==='",
            "tail -n 8 /var/www/html/wordpress/wp-content/hyperdb-queries.log 2>/dev/null || true",
        ]

        try:
            cmd_resp = self.ssm.send_command(
                InstanceIds=[HML_INSTANCE_ID],
                DocumentName="AWS-RunShellScript",
                Parameters={"commands": commands},
                TimeoutSeconds=30,
            )
            cmd_id = cmd_resp["Command"]["CommandId"]

            for _ in range(12):
                time.sleep(1.2)
                inv = self.ssm.get_command_invocation(
                    CommandId=cmd_id,
                    InstanceId=HML_INSTANCE_ID,
                )
                status = inv.get("Status")
                if status in ("Success", "Failed", "TimedOut", "Cancelled"):
                    return {
                        "status": status,
                        "raw_output": inv.get("StandardOutputContent", ""),
                        "stderr": inv.get("StandardErrorContent", ""),
                    }
            return {"status": "TimeoutPollingSSM", "raw_output": "", "stderr": "SSM invocation timed out locally"}
        except Exception as exc:
            return {"status": "Error", "raw_output": "", "stderr": str(exc)}

    def execute_quick_ssm_poll(self) -> Dict[str, str]:
        commands = [
            "echo '--- STATUS_PHP ---'",
            "systemctl status php8.3-fpm --no-pager | grep -E 'Status:|Tasks:|Memory:' || true",
            "echo '--- SOCKETS_RDS ---'",
            "ss -tan 'sport = :3306 or dport = :3306' | wc -l",
            "echo '--- LOAD_AVG ---'",
            "uptime | awk -F'load average:' '{print $2}'",
            "echo '--- LAST_NGINX_ERROR ---'",
            "tail -n 2 /var/log/nginx/error.log 2>/dev/null || true",
            "echo '--- LAST_WP_QUERY ---'",
            "tail -n 1 /var/www/html/wordpress/wp-content/hyperdb-queries.log 2>/dev/null || true",
        ]
        try:
            resp = self.ssm.send_command(
                InstanceIds=[HML_INSTANCE_ID],
                DocumentName="AWS-RunShellScript",
                Parameters={"commands": commands},
                TimeoutSeconds=30,
            )
            cid = resp["Command"]["CommandId"]
            for _ in range(8):
                time.sleep(1.0)
                inv = self.ssm.get_command_invocation(CommandId=cid, InstanceId=HML_INSTANCE_ID)
                if inv.get("Status") in ("Success", "Failed", "TimedOut"):
                    return {"status": inv.get("Status", "Unknown"), "output": inv.get("StandardOutputContent", "")}
            return {"status": "TimedOut", "output": ""}
        except Exception as exc:
            return {"status": "Error", "output": str(exc)}

    def run_live_watch(self, interval: int = 5) -> None:
        print(format_header(f"MODO LIVE WATCH - TELEMETRIA EC2/RDS HML EM TEMPO REAL (Intervalo: {interval}s)"))
        print(f"{COLOR_YELLOW}Pressione Ctrl+C para encerrar o monitoramento.{COLOR_RESET}\n")

        iter_count = 0
        try:
            while True:
                iter_count += 1
                now_str = datetime.datetime.now().strftime("%H:%M:%S")
                print(f"{COLOR_BOLD}{COLOR_BLUE}[{now_str}] Ciclo #{iter_count} - Inspecionando {HML_INSTANCE_ID}...{COLOR_RESET}")

                poll = self.execute_quick_ssm_poll()
                if poll.get("status") == "Success":
                    raw = poll.get("output", "")
                    sections = raw.split("--- ")
                    parsed: Dict[str, str] = {}
                    for sec in sections:
                        if not sec.strip():
                            continue
                        lines = sec.strip().split("\n")
                        title = lines[0].replace(" ---", "")
                        parsed[title] = "\n".join(lines[1:]).strip()

                    status_php = parsed.get("STATUS_PHP", "N/A")
                    sockets_rds = parsed.get("SOCKETS_RDS", "0")
                    load_avg = parsed.get("LOAD_AVG", "N/A")
                    last_nginx = parsed.get("LAST_NGINX_ERROR", "")
                    last_query = parsed.get("LAST_WP_QUERY", "")

                    # Output compacto
                    print(f"  * {COLOR_BOLD}PHP 8.3 FPM:{COLOR_RESET} {status_php}")
                    print(f"  * {COLOR_BOLD}Conexoes RDS (3306):{COLOR_RESET} {sockets_rds} sockets | {COLOR_BOLD}Load Avg:{COLOR_RESET} {load_avg}")

                    if "upstream timed out" in last_nginx or "Connection timed out" in last_nginx:
                        print(f"  * {COLOR_BOLD}{COLOR_RED}Ultimo erro Nginx:{COLOR_RESET} {last_nginx}")
                    elif last_nginx:
                        print(f"  * {COLOR_BOLD}Ultimo log Nginx:{COLOR_RESET} {last_nginx[:120]}")

                    if last_query:
                        print(f"  * {COLOR_BOLD}Ultima query HyperDB:{COLOR_RESET} {last_query[:120]}")
                else:
                    print(f"  {COLOR_RED}[Aviso] Falha na telemetria rapida: {poll.get('status')}{COLOR_RESET}")

                print("-" * 70)
                time.sleep(interval)
        except KeyboardInterrupt:
            print(f"\n{COLOR_GREEN}[INFO] Live Watch encerrado pelo operador.{COLOR_RESET}")


def render_terminal_report(telemetry: Dict[str, Any], minutes: int) -> None:
    print(format_header(f"RELATORIO DE TELEMETRIA INTEGRADA HML (Ultimos {minutes} minutos)"))

    cw_metrics = telemetry.get("cw_metrics", {})
    ssm_data = telemetry.get("ec2_ssm", {})
    cw_logs = telemetry.get("cw_logs", {})

    # 1. EC2 & Compute
    print(format_section(f"1. Computacao EC2 ({HML_INSTANCE_ID})"))
    cpu_pts = cw_metrics.get("ec2_cpu_max", [])
    if cpu_pts and "Maximum" in cpu_pts[-1]:
        print(f"  * CPU Maxima (CW): {COLOR_BOLD}{cpu_pts[-1]['Maximum']:.1f}%{COLOR_RESET} (Ultimo registro)")
    else:
        print("  * CPU Maxima (CW): sem datapoints recentes")
    mem_pts = cw_metrics.get("ec2_mem_used", [])
    if mem_pts and "Maximum" in mem_pts[-1]:
        print(f"  * Memoria Utilizada (CWAgent): {COLOR_BOLD}{mem_pts[-1]['Maximum']:.1f}%{COLOR_RESET}")

    # 2. Load Balancers & 504 Tracking
    print(format_section("2. Roteamento e Balanceadores (ALB Azion & Classic ELB)"))
    alb_req = sum(p.get("Sum", 0) for p in cw_metrics.get("alb_requests", []) if isinstance(p, dict))
    alb_504 = sum(p.get("Sum", 0) for p in cw_metrics.get("alb_elb_504", []) if isinstance(p, dict))
    alb_5xx = sum(p.get("Sum", 0) for p in cw_metrics.get("alb_target_5xx", []) if isinstance(p, dict))
    print(f"  * ALB Azion ({HML_ALB_DIM.split('/')[1]}):")
    print(f"    - Total Requests: {alb_req:.0f}")
    c504 = COLOR_RED if alb_504 > 0 else COLOR_GREEN
    print(f"    - HTTP 504 Gateway Timeout: {c504}{COLOR_BOLD}{alb_504:.0f}{COLOR_RESET}")
    c5xx = COLOR_RED if alb_5xx > 0 else COLOR_GREEN
    print(f"    - Target 5XX Erros: {c5xx}{COLOR_BOLD}{alb_5xx:.0f}{COLOR_RESET}")

    elb_req = sum(p.get("Sum", 0) for p in cw_metrics.get("elb_requests", []) if isinstance(p, dict))
    elb_5xx = sum(p.get("Sum", 0) for p in cw_metrics.get("elb_backend_5xx", []) if isinstance(p, dict))
    print(f"  * Classic ELB ({HML_ELB_NAME}):")
    print(f"    - Total Requests: {elb_req:.0f} | Backend 5XX: {elb_5xx:.0f}")

    # 3. RDS Aurora
    print(format_section(f"3. Banco de Dados RDS Aurora ({HML_RDS_CLUSTER})"))
    rds_insts = cw_metrics.get("rds_instances", {})
    for inst, m in rds_insts.items():
        conns = m.get("connections", [])
        c_val = conns[-1].get("Maximum", 0) if conns and isinstance(conns[-1], dict) and "Maximum" in conns[-1] else 0
        cpu = m.get("cpu_max", [])
        cpu_val = cpu[-1].get("Maximum", 0) if cpu and isinstance(cpu[-1], dict) and "Maximum" in cpu[-1] else 0
        print(f"  * Instancia {COLOR_BOLD}{inst}{COLOR_RESET}: CPU {cpu_val:.1f}% | Conexoes ativas: {c_val:.0f}")

    # 4. EC2 Inside Diagnostics (SSM)
    print(format_section(f"4. Diagnostico Interno da EC2 via SSM ({HML_INSTANCE_ID})"))
    ssm_status = ssm_data.get("status")
    if ssm_status == "Success":
        raw = ssm_data.get("raw_output", "")
        blocks = raw.split("=== ")
        for block in blocks:
            if not block.strip():
                continue
            lines = block.strip().split("\n")
            header = lines[0].replace(" ===", "")
            print(f"\n  [{COLOR_BOLD}{COLOR_YELLOW}{header}{COLOR_RESET}]")
            for line in lines[1:]:
                if "upstream timed out" in line or "Connection timed out" in line or "Fatal error" in line:
                    print(f"    {COLOR_RED}{line}{COLOR_RESET}")
                elif "Processes active" in line or "load average" in line or "Mem:" in line:
                    print(f"    {COLOR_GREEN}{line}{COLOR_RESET}")
                else:
                    print(f"    {line}")
    else:
        print(f"  {COLOR_RED}Falha ao consultar SSM: status={ssm_status}, err={ssm_data.get('stderr')}{COLOR_RESET}")

    # 5. RDS Logs & Nginx CW Logs
    print(format_section("5. Logs Relevantes do CloudWatch (RDS Slowquery & Nginx)"))
    slow_logs = cw_logs.get("rds_slowquery", [])
    if slow_logs and not slow_logs[0].startswith("(Aviso:"):
        print(f"  * RDS Slow Queries recentes ({len(slow_logs)} encontradas):")
        for s in slow_logs[:3]:
            print(f"    {s[:140]}")
    else:
        print(f"  * RDS Slow Queries: {COLOR_GREEN}Nenhuma query lenta registrada no intervalo.{COLOR_RESET}")

    print(format_header("FIM DA TELEMETRIA HML"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Coletor Integrado de Telemetria HML (CloudWatch + SSM + RDS)")
    parser.add_argument("--minutes", "-m", type=int, default=15, help="Janela de tempo em minutos retroativos (padrao: 15)")
    parser.add_argument("--region", "-r", type=str, default=os.getenv("AWS_REGION", "us-east-1"), help="Regiao AWS")
    parser.add_argument("--json", action="store_true", help="Saida em formato JSON bruto")
    parser.add_argument("--watch", "-w", action="store_true", help="Modo Live Watch: monitora EC2/RDS continuamente")
    parser.add_argument("--interval", "-i", type=int, default=5, help="Intervalo em segundos para o modo watch (padrao: 5)")
    args = parser.parse_args()

    collector = HmlTelemetryCollector(region=args.region, minutes=args.minutes)

    if args.watch:
        collector.run_live_watch(interval=args.interval)
        return

    cw_metrics = collector.collect_cloudwatch_metrics()
    cw_logs = collector.collect_cloudwatch_logs()
    ec2_ssm = collector.collect_ec2_internal_ssm()

    telemetry = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "window_minutes": args.minutes,
        "region": args.region,
        "cw_metrics": cw_metrics,
        "cw_logs": cw_logs,
        "ec2_ssm": ec2_ssm,
    }

    if args.json:
        def default_serializer(o: Any) -> Any:
            if isinstance(o, (datetime.datetime, datetime.date)):
                return o.isoformat()
            return str(o)

        print(json.dumps(telemetry, indent=2, default=default_serializer))
    else:
        render_terminal_report(telemetry, args.minutes)


if __name__ == "__main__":
    main()
