"""Encaminha o teste ao ALB pela rede privada, mantendo hostname e TLS."""

import ipaddress
from urllib.parse import urlsplit

from ec2_smoke import run_tunnel_smoke
from hml_context import Aws


def private_address(client, topology):
    description = "ELB " + topology["alb"]["LoadBalancerArn"].split("loadbalancer/")[1]
    interfaces = client.call("ec2", "describe-network-interfaces", filters=[
        {"Name": "description", "Values": [description]},
        {"Name": "vpc-id", "Values": [topology["alb"]["VpcId"]]},
    ])["NetworkInterfaces"]
    addresses = sorted(
        item["PrivateIpAddress"] for item in interfaces
        if item.get("VpcId") == topology["alb"]["VpcId"]
        and ipaddress.ip_address(item["PrivateIpAddress"]).is_private
    )
    if not addresses:
        raise RuntimeError("Nenhuma interface privada do ALB HML foi encontrada.")
    return addresses[0]


def run_private_alb(args, topology, manifest, save, params, invoke):
    address = private_address(Aws(), topology)
    manifest["connection_mode"] = "ssm_private_alb"
    manifest["alb_private_ip"] = address
    save()

    def record_host(instance):
        manifest["selected_instance"] = instance
        save()

    def execute(binary, tunnel_url, forwarded, scenario):
        port = urlsplit(tunnel_url).port
        print("ALB HML via túnel privado SSM, com hostname e TLS preservados.", flush=True)
        return invoke(args, [*forwarded, "-e", f"HML_ALB_IP=127.0.0.1:{port}"])

    return run_tunnel_smoke(args.k6, params, args.scenario,
                            {**topology, "ssm_port": 443}, record_host, execute,
                            remote_host=address)
