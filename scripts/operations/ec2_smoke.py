#!/usr/bin/env python3
"""Executa o smoke em uma instância atual de HML por túnel SSM temporário."""

from __future__ import annotations

import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import time
import sys

from hml_context import Aws, discover, online_instance

def wait_for_tunnel(port: int, process: subprocess.Popen) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            if process.poll() not in (None, 0):
                raise RuntimeError("O túnel SSM falhou ao iniciar.")
            time.sleep(0.2)
    raise RuntimeError("O túnel SSM não abriu a porta local em 30 segundos.")


def run_smoke(binary: str, target: str, args: list[str], scenario: str = "smoke") -> int:
    return subprocess.run([
        binary, "run", *args, "-e", "TARGET_ENV=hml_ec2_direct",
        "-e", "SMOKE_MULTI_PROXY_IP=", "-e", "HML_ALB_IP=", "-e", "TARGET_URL=" + target,
         f"src/presentation/scenarios/{scenario}.ts",
    ]).returncode


def run_tunnel_smoke(binary: str, args: list[str], scenario: str = "smoke",
                     topology: dict | None = None, on_start=None, execute=None) -> int:
    client = Aws()
    topology = topology or discover(client)
    instance = online_instance(client, topology)
    region = topology["region"]
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    print(f"Teste HML na instância {instance}, via SSM para a porta {topology['ssm_port']}.", flush=True)
    if on_start:
        on_start(instance)
    with tempfile.TemporaryFile(mode="w+") as log:
        process = subprocess.Popen([
            "aws", "ssm", "start-session", "--region", region,
            "--target", instance, "--document-name", "AWS-StartPortForwardingSession",
            "--parameters", json.dumps({
                "portNumber": [str(topology["ssm_port"])], "localPortNumber": [str(port)],
            }),
        ], stdout=log, stderr=log, start_new_session=True)
        try:
            wait_for_tunnel(port, process)
            return (execute or run_smoke)(binary, f"http://127.0.0.1:{port}", args, scenario)
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            log.seek(0)
            output = log.read()
            session = re.search(r"SessionId:\s*([\w-]+)", output)
            if session:
                subprocess.run([
                    "aws", "ssm", "terminate-session", "--region", region,
                    "--session-id", session.group(1), "--no-cli-pager",
                ], capture_output=True, check=False)
            print("Encerrada a coleta pelo túnel SSM.", flush=True)


def main() -> int:
    from run_hml import main as run_main
    return run_main(["--target", "hml_ec2_direct", *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(main())
