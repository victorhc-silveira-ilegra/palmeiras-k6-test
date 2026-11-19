"""Identidade e descoberta de recursos explicitamente vinculados ao HML."""

from __future__ import annotations

import datetime as dt
import copy
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "data/hml-topology.json").read_text())
UTC = dt.timezone.utc


def timestamp(value: str) -> dt.datetime:
    result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("O horário deve informar o fuso.")
    return result.astimezone(UTC)


def sanitize(value: str) -> str:
    value = re.sub(
        r"(?im)\b(authorization|cookie)\s*[=:]\s*[^\n]+",
        lambda match: match[1] + "=[omitido]", value,
    )
    value = re.sub(
        r"""(?ix)(["']?(?:authorization|cookie|password|passwd|token|secret|nonce|api[_-]?key)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)""",
        lambda match: match[1] + '"[omitido]"', value,
    )
    value = re.sub(r"(?i)Bearer\s+[^\s,]+", "Bearer [omitido]", value)
    value = re.sub(r"(https?://[^\s?]+)\?[^\s]+", r"\1?[omitido]", value)
    return value[:256]


def route(value: str) -> str:
    return sanitize(urlsplit(value).path)


class Aws:
    def __init__(self, region: str = CONFIG["region"]):
        if region != CONFIG["region"]:
            raise ValueError("Região fora da configuração de HML.")
        self.region = region

    def command(self, service: str, operation: str, *args: str) -> list[str]:
        return [
            "aws", service, operation, "--region", self.region,
            "--no-cli-pager", "--cli-connect-timeout", "5", "--cli-read-timeout", "20", *args,
        ]

    def call(self, service: str, operation: str, **params):
        args = []
        for key, value in params.items():
            args.extend(["--" + key.replace("_", "-"),
                         value if isinstance(value, str) else json.dumps(value)])
        result = subprocess.run(
            self.command(service, operation, *args, "--output", "json", "--no-paginate"),
            capture_output=True, check=False, text=True, timeout=60,
        )
        if result.returncode:
            raise RuntimeError(sanitize(result.stderr))
        return json.loads(result.stdout)

    def pages(self, service: str, operation: str, result_key: str, **params):
        seen = set()
        while True:
            response = self.call(service, operation, **params)
            yield from response.get(result_key, [])
            token = response.get("NextToken") or response.get("nextToken")
            if not token or token in seen:
                return
            seen.add(token)
            params["next_token"] = token


def discover(client: Aws, mode: str | None = None) -> dict:
    mode = mode or os.getenv("HML_TOPOLOGY", "current")
    if mode not in ("current", "legacy"):
        raise ValueError("HML_TOPOLOGY deve ser current ou legacy.")
    identity = client.call("sts", "get-caller-identity")
    if identity["Account"] != CONFIG["account"]:
        raise RuntimeError("Conta ativa diferente da conta de HML.")
    selected = CONFIG[mode]
    alb = client.call("elbv2", "describe-load-balancers",
                      names=[selected["alb"]])["LoadBalancers"][0]
    arn_prefix = f"arn:aws:elasticloadbalancing:{client.region}:{CONFIG['account']}:"
    if not alb["LoadBalancerArn"].startswith(arn_prefix + "loadbalancer/app/" + selected["alb"] + "/"):
        raise RuntimeError("ARN inesperado para o ALB de HML.")
    tg = client.call("elbv2", "describe-target-groups",
                     names=[selected["target_group"]])["TargetGroups"][0]
    if not tg["TargetGroupArn"].startswith(arn_prefix + "targetgroup/" + selected["target_group"] + "/"):
        raise RuntimeError("ARN inesperado para o target group de HML.")
    if alb["LoadBalancerArn"] not in tg["LoadBalancerArns"]:
        raise RuntimeError("Target group não pertence ao ALB esperado.")
    health = client.call("elbv2", "describe-target-health",
                         target_group_arn=tg["TargetGroupArn"])["TargetHealthDescriptions"]
    if mode == "current":
        group = client.call(
            "autoscaling", "describe-auto-scaling-groups",
            auto_scaling_group_names=[selected["asg"]],
        )["AutoScalingGroups"][0]
        if tg["TargetGroupArn"] not in group["TargetGroupARNs"]:
            raise RuntimeError("ASG não pertence ao target group esperado.")
        instances = group["Instances"]
    else:
        if selected["instance"] not in {entry["Target"]["Id"] for entry in health}:
            raise RuntimeError("EC2 legada ausente do target group.")
        instances = [{"InstanceId": selected["instance"]}]
        group = None
    ids = sorted(entry["InstanceId"] for entry in instances)
    if not ids:
        raise RuntimeError("Nenhuma instância encontrada na topologia HML.")
    ec2 = client.call("ec2", "describe-instances", instance_ids=ids)
    hosts = [instance for reservation in ec2["Reservations"] for instance in reservation["Instances"]]
    if {host["InstanceId"] for host in hosts} != set(ids):
        raise RuntimeError("Inventário EC2 diverge dos membros de HML.")
    if any(host["VpcId"] != alb["VpcId"] for host in hosts):
        raise RuntimeError("EC2 fora da VPC do ALB de HML.")
    return {
        "mode": mode, "account": identity["Account"], "region": client.region,
        "hostname": CONFIG["hostname"], "alb": alb, "target_group": tg,
        "asg": group, "instances": hosts, "target_health": health,
        "ssm_port": selected["ssm_port"], "rds_cluster": selected["rds_cluster"],
        "database": selected["database"],
    }


def online_instance(client: Aws, topology: dict) -> str:
    healthy = {
        item["Target"]["Id"] for item in topology["target_health"]
        if item["TargetHealth"]["State"] == "healthy"
    }
    if topology["asg"]:
        healthy &= {
            item["InstanceId"] for item in topology["asg"]["Instances"]
            if item["LifecycleState"] == "InService" and item["HealthStatus"] == "Healthy"
        }
    if not healthy:
        raise RuntimeError("Nenhuma instância saudável disponível.")
    entries = client.call(
        "ssm", "describe-instance-information",
        filters=[{"Key": "InstanceIds", "Values": sorted(healthy)}],
    )["InstanceInformationList"]
    candidates = sorted(
        item["InstanceId"] for item in entries
        if item["PingStatus"] == "Online" and item["InstanceId"] in healthy
    )
    if not candidates:
        raise RuntimeError("Nenhuma instância saudável está online no SSM.")
    return candidates[0]


def source(fetch) -> dict:
    try:
        data = fetch()
        return {"status": "ok" if data else "no_data", "data": data}
    except Exception as exc:
        message = sanitize(str(exc))
        unavailable = any(code in message for code in ("ResourceNotFound", "NoSuchBucket", "FileSystemNotFound"))
        return {"status": "unavailable" if unavailable else "error", "error": message}


def historical_topology(client, manifest, current):
    historical = copy.deepcopy(current)
    ids = manifest["instance_ids"]
    if not isinstance(ids, list) or any(not re.fullmatch(r"i-[a-f0-9]{8,17}", host) for host in ids):
        raise ValueError("IDs de instância inválidos no manifesto.")
    filters = [{"Name": "instance-id", "Values": ids}]
    if current["mode"] == "current":
        filters.append({"Name": "tag:aws:autoscaling:groupName", "Values": [current["asg"]["AutoScalingGroupName"]]})
    else:
        if ids != [CONFIG["legacy"]["instance"]]:
            raise ValueError("Manifesto legado contém instância fora do escopo.")
    reservations = client.call("ec2", "describe-instances", filters=filters)["Reservations"]
    historical["instances"] = [
        host for entry in reservations for host in entry["Instances"]
        if host["InstanceId"] in ids and host["VpcId"] == current["alb"]["VpcId"]
    ]
    found = {host["InstanceId"] for host in historical["instances"]}
    historical["unavailable_historical_instances"] = [host for host in ids if host not in found]
    return historical
