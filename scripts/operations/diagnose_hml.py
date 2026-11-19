#!/usr/bin/env python3
"""Consolida evidências de uma rodada e arquivos opcionais fornecidos pela Azion."""

import argparse
import datetime as dt
import json
from pathlib import Path
import sys

from hml_context import Aws, ROOT, UTC, discover, historical_topology, sanitize, source
from hml_logs import azion_logs
from hml_telemetry import collect, load_window


def k6_results(manifest):
    matches = []
    for path in (ROOT / "reports").glob("summary-*.json"):
        data = json.loads(path.read_text())
        scenario = data.get("scenario", {})
        if scenario.get("run_id") != manifest["run_id"]:
            continue
        metrics = data.get("metrics", {})
        failed = []
        for name, metric in metrics.items():
            for threshold, outcome in metric.get("thresholds", {}).items():
                if not outcome["ok"]:
                    failed.append({"metric": name, "threshold": threshold})
        matches.append({
            "file": path.name, "scenario": scenario, "failed_thresholds": failed,
            "transport_failures": metrics.get("edge_transport_drop", {}).get("values", {}).get("count", 0),
            "http_504": metrics.get("gateway_timeout_504", {}).get("values", {}).get("count", 0),
            "redirects_observed": metrics.get("prod_redirect_detected", {}).get("values", {}).get("count", 0),
            "checks": metrics.get("checks", {}).get("values", {}),
        })
    return matches



def findings(manifest, results):
    items = []
    if results["status"] != "ok":
        return ["Resumo k6 indisponível para esta rodada."]
    for result in results["data"]:
        if result["transport_failures"]:
            items.append("Falha de transporte sem resposta HTTP observada pelo cliente.")
        if result["http_504"]:
            items.append("HTTP 504 recebido pelo cliente.")
        thresholds = result["failed_thresholds"]
        if any(item["metric"] == "checks{check:no_prod_redirect}" for item in thresholds):
            items.append("Redirecionamento para alvo proibido reprovou a proteção.")
        if result["checks"].get("fails", 0):
            items.append("Há checks funcionais reprovados.")
        if any(item["metric"].startswith("http_req_duration") for item in thresholds):
            items.append("O perfil reprovou os limites de latência.")
    if manifest["exit_code"] != 0 and not items:
        items.append("A execução terminou com erro; consulte os thresholds e o código de saída.")
    return list(dict.fromkeys(items))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True)
    parser.add_argument("--azion-log")
    args = parser.parse_args()
    start, end, manifest = load_window(args.run, 15)
    client = Aws()
    topology = discover(client, manifest["topology_mode"])
    if manifest["account"] != topology["account"] or manifest["region"] != topology["region"]:
        raise ValueError("Manifesto não pertence à conta e região de HML.")
    if manifest["alb_arn"] != topology["alb"]["LoadBalancerArn"]:
        raise ValueError("ALB do manifesto diverge da descoberta atual.")
    current = topology
    topology = historical_topology(client, manifest, current)
    result = collect(client, topology, start, end, include_hosts=False)
    result["current_instance_ids"] = [host["InstanceId"] for host in current["instances"]]
    result["run_id"] = manifest["run_id"]
    result["k6"] = source(lambda: k6_results(manifest))
    result["run_result"] = manifest["status"]
    result["findings"] = findings(manifest, result["k6"])
    result["azion"] = source(lambda: azion_logs(
        args.azion_log, start, end, result["alb_access_logs"],
    )) if args.azion_log else {"status": "unavailable", "note": "Aguardando arquivo da equipe."}
    result["historical_instances"] = manifest["instance_ids"]
    result["correlation"] = {
        "status": "pending",
        "note": "Registros do ALB são candidatos por janela; o ALB não registra cabeçalhos arbitrários.",
    }
    result["generated_at"] = dt.datetime.now(UTC).isoformat()
    output = ROOT / "reports" / "runs" / f"{manifest['run_id']}-diagnostico.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"Diagnóstico da rodada {manifest['run_id']}")
    print("Resultado da execução = " + manifest["status"])
    for item in result["findings"]:
        print("Evidência = " + item)
    for key in ("k6", "alb_access_logs", "azion", "traces"):
        print(key + " = " + result[key]["status"])
    print("Correlação pendente de confirmação dos candidatos.")
    print("Relatório " + str(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("Diagnóstico interrompido: " + sanitize(str(exc)), file=sys.stderr)
        sys.exit(1)
