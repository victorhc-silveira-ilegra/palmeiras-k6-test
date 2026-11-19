#!/usr/bin/env python3
"""Inventário de leitura dos recursos vinculados à topologia selecionada de HML."""

import json
import sys

from hml_context import Aws, discover, sanitize, source


def main():
    client = Aws()
    topology = discover(client)
    arn = topology["alb"]["LoadBalancerArn"]
    topology["alb_attributes"] = source(lambda: client.call(
        "elbv2", "describe-load-balancer-attributes", load_balancer_arn=arn,
    )["Attributes"])
    topology["listeners"] = source(lambda: client.call(
        "elbv2", "describe-listeners", load_balancer_arn=arn,
    )["Listeners"])
    topology["rds_shared_context"] = source(lambda: [
        {"id": cluster["DBClusterIdentifier"], "status": cluster["Status"],
         "logs": cluster.get("EnabledCloudwatchLogsExports", []),
         "scope": "shared_cluster_context"}
        for cluster in client.call(
            "rds", "describe-db-clusters", db_cluster_identifier=topology["rds_cluster"],
        )["DBClusters"]
    ])
    print(json.dumps(topology, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Recon HML interrompido: " + sanitize(str(exc)), file=sys.stderr)
        sys.exit(1)
