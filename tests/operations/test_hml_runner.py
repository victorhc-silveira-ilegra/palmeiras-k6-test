"""Integração local do controlador, sem conexão com AWS ou aplicação."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from test_hml_alignment import FixtureAws
from hml_context import ROOT


class RunnerIntegrationTests(unittest.TestCase):
    def test_native_paths_manifest_failure_and_tunnel_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            fixture = FixtureAws()
            fixture.responses[("elbv2", "describe-load-balancers")]["LoadBalancers"][0]["DNSName"] = "localhost"
            responses = {"/".join(key): value for key, value in fixture.responses.items()}
            (folder / "responses.json").write_text(json.dumps(responses))
            aws = folder / "aws"
            aws.write_text("""#!/usr/bin/env python3
import json,os,pathlib,socket,sys
args=sys.argv[1:]
key='/'.join(args[:2])
root=pathlib.Path(os.environ['HML_FIXTURE'])
if key=='ssm/start-session':
 params=json.loads(args[args.index('--parameters')+1])
 print('Starting session with SessionId: fixture-session',flush=True)
 (root/'tunnel-pid').write_text(str(os.getpid()))
 s=socket.socket();s.bind(('127.0.0.1',int(params['localPortNumber'][0])));s.listen()
 while True:
  connection,_=s.accept();connection.close()
elif key=='ssm/terminate-session':
 (root/'terminated').write_text('yes')
 print('{}')
else:
 print(json.dumps(json.loads((root/'responses.json').read_text())[key]))
""")
            k6 = folder / "k6-local"
            k6.write_text("""#!/usr/bin/env python3
import json,os,pathlib,sys
pathlib.Path(os.environ['HML_FIXTURE'],'k6-args').write_text(json.dumps(sys.argv[1:]))
sys.exit(int(os.getenv('HML_TEST_EXIT','0')))
""")
            aws.chmod(0o700)
            k6.chmod(0o700)
            env = {**os.environ, "PATH": str(folder) + ":" + os.environ["PATH"],
                   "HML_FIXTURE": str(folder), "HML_TOPOLOGY": "current"}
            for target, code in [("azion_edge", 0), ("hml_alb", 99), ("hml_ec2_direct", 0)]:
                env["HML_TEST_EXIT"] = str(code)
                result = subprocess.run([
                    "python3", "scripts/operations/run_hml.py",
                    "--k6", str(k6), "--target", target, "--",
                    "-e", "SMOKE_PROFILE=functional", "-e", "REQUEST_TIMEOUT=15s",
                    "-e", "WP_AUTH_COOKIE=fixture-secret",
                ], cwd=ROOT, env=env, text=True, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, code, result.stderr)
                line = next(line for line in result.stdout.splitlines() if line.startswith("Manifesto da rodada "))
                manifest_path = Path(line.removeprefix("Manifesto da rodada "))
                try:
                    text = manifest_path.read_text()
                    self.assertNotIn("fixture-secret", text)
                    manifest = json.loads(text)
                    self.assertEqual(manifest["exit_code"], code)
                    self.assertLessEqual(manifest["started_at_utc"], manifest["finished_at_utc"])
                    args = json.loads((folder / "k6-args").read_text())
                    self.assertIn("HML_RUN_ID=" + manifest["run_id"], args)
                    values = dict(
                        args[index + 1].split("=", 1) for index, item in enumerate(args[:-1])
                        if item == "-e"
                    )
                    if target == "hml_alb":
                        self.assertEqual(values["TARGET_URL"], "https://hmlverdao.palmeiras.com.br")
                        self.assertTrue(values["HML_ALB_IP"])
                    if target == "hml_ec2_direct":
                        self.assertTrue(values["TARGET_URL"].startswith("http://127.0.0.1:"))
                        self.assertTrue((folder / "terminated").exists())
                        pid = int((folder / "tunnel-pid").read_text())
                        with self.assertRaises(ProcessLookupError):
                            os.kill(pid, 0)
                finally:
                    manifest_path.unlink()

    def test_docker_uses_resolved_parameters(self):
        from unittest.mock import Mock, patch
        import argparse
        from run_hml import invoke
        args = argparse.Namespace(k6="k6", docker=True, scenario="smoke")
        with patch("run_hml.subprocess.run", return_value=Mock(returncode=0)) as execute:
            self.assertEqual(invoke(args, ["-e", "HML_RUN_ID=example"]), 0)
            command = execute.call_args.args[0]
            self.assertEqual(command[:2], ["docker", "compose"])
            self.assertIn("HML_RUN_ID=example", command)
            self.assertEqual(command[-1], "src/presentation/scenarios/smoke.ts")


class HostAndMetricTests(unittest.TestCase):
    def test_php_service_matches_active_upstream(self):
        from unittest.mock import Mock, patch
        from hml_hosts import REMOTE
        with tempfile.TemporaryDirectory() as directory:
            empty = Path(directory) / "log"
            empty.write_text("")
            def command(args, **kwargs):
                text = ""
                if args[:2] == ["nginx", "-T"]:
                    text = "# fastcgi_pass unix:/run/old.sock;\nfastcgi_pass unix:/run/new.sock;"
                elif args[:2] == ["systemctl", "list-units"]:
                    text = "php7.4-fpm.service active\nphp8.3-fpm.service active"
                elif args[:2] == ["systemctl", "show"]:
                    pid = "83" if args[2] == "php8.3-fpm.service" else "74"
                    text = "ActiveState=active\nMainPID=" + pid
                elif args[:2] == ["ss", "-xlpn"]:
                    text = '/run/new.sock users:(("php-fpm",pid=83,fd=4))\n/run/old.sock users:(("php-fpm",pid=74,fd=4))'
                return Mock(stdout=text, returncode=0)
            with patch("pathlib.Path", return_value=empty), \
                 patch("subprocess.run", side_effect=command), patch("builtins.print") as output:
                exec(REMOTE, {"START": "2026-11-19T00:00:00+00:00", "END": "2026-11-19T23:59:59+00:00"})
            data = json.loads(output.call_args.args[0])
            self.assertEqual(data["upstream_sockets"], ["unix:/run/new.sock"])
            self.assertTrue(data["php_services"]["php8.3-fpm.service"]["serves_upstream"])
            self.assertFalse(data["php_services"]["php7.4-fpm.service"]["serves_upstream"])

    def test_memory_uses_discovered_dimensions(self):
        from unittest.mock import patch
        from hml_context import discover, timestamp
        from hml_telemetry import collect_metrics
        client = FixtureAws()
        topology = discover(client, "current")
        original = client.call
        def call(service, operation, **params):
            if service == "cloudwatch" and operation == "list-metrics":
                return {"Metrics": [{"Dimensions": [
                    {"Name": "InstanceId", "Value": "i-hml"},
                    {"Name": "host", "Value": "host-hml"},
                ]}]}
            return original(service, operation, **params)
        with patch.object(client, "call", side_effect=call):
            result = collect_metrics(client, topology, timestamp("2026-11-19T00:00:00Z"),
                                     timestamp("2026-11-19T00:01:00Z"))
            self.assertEqual(result["i-hml_memory"]["dimensions"]["host"], "host-hml")


if __name__ == "__main__":
    unittest.main()
