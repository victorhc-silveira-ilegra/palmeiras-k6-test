"""Regressões de descoberta, correlação e ciclo de vida dos executores HML."""

import argparse
import copy
import datetime as dt
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts/operations"))
from hml_context import Aws, CONFIG, UTC, discover, online_instance, sanitize, source, timestamp
from hml_logs import azion_logs, parse_alb, overlaps_delivery
from hml_telemetry import collect_metrics, load_window
from hml_hosts import inspect_host
import ec2_smoke
import run_hml


class FixtureAws:
    region = "us-east-1"

    def __init__(self):
        prefix = "arn:aws:elasticloadbalancing:us-east-1:000491796368:"
        self.alb = prefix + "loadbalancer/app/teste-multi-proxy/abc"
        self.tg = prefix + "targetgroup/palmeiras-hml-https/xyz"
        self.responses = {
            ("sts", "get-caller-identity"): {"Account": CONFIG["account"]},
            ("elbv2", "describe-load-balancers"): {"LoadBalancers": [{
                "LoadBalancerArn": self.alb, "LoadBalancerName": "teste-multi-proxy",
                "VpcId": "vpc-hml", "DNSName": "teste-multi-proxy.example",
            }]},
            ("elbv2", "describe-target-groups"): {"TargetGroups": [{
                "TargetGroupArn": self.tg, "LoadBalancerArns": [self.alb],
            }]},
            ("elbv2", "describe-target-health"): {"TargetHealthDescriptions": [{
                "Target": {"Id": "i-hml"}, "TargetHealth": {"State": "healthy"},
            }]},
            ("autoscaling", "describe-auto-scaling-groups"): {"AutoScalingGroups": [{
                "TargetGroupARNs": [self.tg], "Instances": [{
                    "InstanceId": "i-hml", "HealthStatus": "Healthy", "LifecycleState": "InService",
                }],
            }]},
            ("ec2", "describe-instances"): {"Reservations": [{"Instances": [{
                "InstanceId": "i-hml", "VpcId": "vpc-hml",
            }]}]},
            ("ec2", "describe-network-interfaces"): {"NetworkInterfaces": [{"VpcId": "vpc-hml", "PrivateIpAddress": "172.31.1.10"}]},
            ("ssm", "describe-instance-information"): {"InstanceInformationList": [{
                "InstanceId": "i-hml", "PingStatus": "Online",
            }]},
        }

    def pages(self, service, operation, result_key, **params):
        yield from self.call(service, operation, **params).get(result_key, [])

    def call(self, service, operation, **params):
        if service == "cloudwatch":
            return {"Datapoints": []}
        return copy.deepcopy(self.responses[(service, operation)])


class DiscoveryTests(unittest.TestCase):
    def test_current_and_rotation(self):
        client = FixtureAws()
        topology = discover(client, "current")
        self.assertEqual(online_instance(client, topology), "i-hml")
        client.responses[("ec2", "describe-instances")]["Reservations"][0]["Instances"][0]["InstanceId"] = "i-new"
        group = client.responses[("autoscaling", "describe-auto-scaling-groups")]
        group["AutoScalingGroups"][0]["Instances"][0]["InstanceId"] = "i-new"
        health = client.responses[("elbv2", "describe-target-health")]
        health["TargetHealthDescriptions"][0]["Target"]["Id"] = "i-new"
        self.assertEqual(discover(client, "current")["instances"][0]["InstanceId"], "i-new")

    def test_wrong_account_stops_before_resources(self):
        client = FixtureAws()
        client.responses[("sts", "get-caller-identity")]["Account"] = "outro"
        with patch.object(client, "call", wraps=client.call) as calls:
            with self.assertRaises(RuntimeError):
                discover(client, "current")
            self.assertEqual(calls.call_count, 1)

    def test_invalid_links_and_vpc(self):
        for field in ("alb", "asg", "vpc"):
            client = FixtureAws()
            if field == "alb":
                client.responses[("elbv2", "describe-target-groups")]["TargetGroups"][0]["LoadBalancerArns"] = []
            elif field == "asg":
                client.responses[("autoscaling", "describe-auto-scaling-groups")]["AutoScalingGroups"][0]["TargetGroupARNs"] = []
            else:
                client.responses[("ec2", "describe-instances")]["Reservations"][0]["Instances"][0]["VpcId"] = "outro"
            with self.assertRaises(RuntimeError):
                discover(client, "current")

    def test_no_healthy_or_ssm_online(self):
        client = FixtureAws()
        topology = discover(client, "current")
        topology["target_health"][0]["TargetHealth"]["State"] = "unhealthy"
        with self.assertRaises(RuntimeError):
            online_instance(client, topology)
        topology = discover(client, "current")
        client.responses[("ssm", "describe-instance-information")]["InstanceInformationList"] = []
        with self.assertRaises(RuntimeError):
            online_instance(client, topology)

    def test_region_and_mode(self):
        with self.assertRaises(ValueError):
            Aws("outra")
        with self.assertRaises(ValueError):
            discover(FixtureAws(), "incorreto")

    def test_pagination(self):
        client = Aws()
        with patch.object(client, "call", side_effect=[
            {"events": [1], "nextToken": "next"},
            {"events": [2], "nextToken": "next"},
        ]):
            self.assertEqual(list(client.pages("logs", "filter-log-events", "events")), [1, 2])

    def test_source_statuses(self):
        self.assertEqual(source(lambda: [])["status"], "no_data")
        self.assertEqual(source(lambda: [0])["status"], "ok")
        def denied():
            raise RuntimeError("AccessDenied")
        self.assertEqual(source(denied)["status"], "error")
        self.assertNotIn("abc123", sanitize("token=abc123 Bearer abc123"))


class CorrelationTests(unittest.TestCase):
    def setUp(self):
        self.start = timestamp("2026-11-19T10:43:00-03:00")
        self.end = timestamp("2026-11-19T13:44:00Z")
        self.line = (
            'https 2026-11-19T13:43:37Z app/a/b 1.2.3.4:123 172.31.1.2:443 '
            '0.001 1.2 0.001 200 200 100 200 '
            '"GET https://hml.example/wp-json/wp/v2/posts?token=secret HTTP/1.1" "k6"'
        )

    def test_alb_route_sanitization_and_window(self):
        result = parse_alb(self.line, self.start, self.end)
        self.assertEqual(result["path"], "/wp-json/wp/v2/posts")
        self.assertNotIn("secret", json.dumps(result))
        self.assertIsNone(parse_alb(self.line, self.end, self.end + dt.timedelta(minutes=1)))
        self.assertTrue(overlaps_delivery("alb_20261119T1345Z_ip", self.start, self.end))

    def test_azion_csv_json_candidates_are_pending(self):
        record = parse_alb(self.line, self.start, self.end)
        for suffix in (".json", ".csv"):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / ("azion" + suffix)
                if suffix == ".json":
                    path.write_text(json.dumps([{
                        "timestamp": "2026-11-19T10:43:37-03:00",
                        "method": "GET", "path": "/wp-json/wp/v2/posts?token=secret",
                    }]))
                else:
                    path.write_text("timestamp,method,path\n2026-11-19T10:43:37-03:00,GET,/wp-json/wp/v2/posts\n")
                result = azion_logs(str(path), self.start, self.end, {"data": {"records": [record]}})
                self.assertEqual(result["data"][0]["alb_candidate_count"], 1)
                self.assertEqual(result["data"][0]["association"], "pending")
        self.assertEqual(azion_logs(None, self.start, self.end, {})["status"], "unavailable")

    def test_manifest_exact_window(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "run.json"
            path.write_text(json.dumps({
                "run_id": "00000000-0000-4000-8000-000000000000",
                "account": CONFIG["account"], "region": CONFIG["region"], "topology_mode": "current",
                "instance_ids": ["i-hml"], "alb_arn": FixtureAws().alb,
                "started_at_utc": self.start.isoformat(), "finished_at_utc": self.end.isoformat(),
            }))
            start, end, _ = load_window(str(path), 15)
            self.assertEqual((start, end), (self.start, self.end))
        with self.assertRaises(ValueError):
            timestamp("2026-11-19T10:43:00")

    def test_cluster_context_and_no_samples(self):
        client = FixtureAws()
        metrics = collect_metrics(client, discover(client, "current"), self.start, self.end)
        self.assertEqual(metrics["alb_requests"]["status"], "no_data")
        self.assertFalse(metrics["rds_shared_CPUUtilization"]["attributed_to_run"])

    def test_ssm_rejects_foreign_host(self):
        with self.assertRaises(ValueError):
            inspect_host(FixtureAws(), {"instances": [{"InstanceId": "i-hml"}]}, "i-outro", self.start, self.end)


class ExecutorTests(unittest.TestCase):
    def test_tunnel_url_wins_over_empty_parameter(self):
        with patch.object(ec2_smoke.subprocess, "run", return_value=Mock(returncode=99)) as execute:
            self.assertEqual(ec2_smoke.run_smoke("k6", "http://127.0.0.1:1234",
                             ["-e", "TARGET_URL="], "api_mix"), 99)
            args = execute.call_args.args[0]
            self.assertGreater(args.index("TARGET_URL=http://127.0.0.1:1234"), args.index("TARGET_URL="))
            self.assertEqual(args[-1], "src/presentation/scenarios/api_mix.ts")

    def test_tunnel_cleanup_on_error_and_interrupt(self):
        client = FixtureAws()
        topology = discover(client, "current")
        for error in (RuntimeError("falha"), KeyboardInterrupt()):
            process = Mock(pid=12345)
            with patch.object(ec2_smoke, "Aws", return_value=client), \
                 patch.object(ec2_smoke, "online_instance", return_value="i-hml"), \
                 patch.object(ec2_smoke.subprocess, "Popen", return_value=process), \
                 patch.object(ec2_smoke, "wait_for_tunnel"), \
                 patch.object(ec2_smoke, "run_smoke", side_effect=error), \
                 patch.object(ec2_smoke.os, "killpg") as kill:
                with self.assertRaises(type(error)):
                    ec2_smoke.run_tunnel_smoke("k6", [], topology=topology)
                kill.assert_called()
                process.wait.assert_called()

    def test_nonzero_k6_and_safe_manifest_parameters(self):
        topology = discover(FixtureAws(), "current")
        args = argparse.Namespace(
            k6="k6", target="azion_edge", target_url="", scenario="smoke",
            k6_args=["--", "-e", "WP_AUTH_COOKIE=segredo", "-e", "SMOKE_PROFILE=strict"],
        )
        manifest = {"run_id": "run-test"}
        with patch.object(run_hml.subprocess, "run", return_value=Mock(returncode=99)):
            self.assertEqual(run_hml.run(args, topology, manifest, lambda: None), 99)
        self.assertNotIn("segredo", json.dumps(manifest))
        self.assertEqual(manifest["profile"], "strict")


class ReviewRegressionTests(unittest.TestCase):
    def test_json_and_inline_credentials_are_redacted(self):
        for message in [
            '{"token":"abc123","authorization":"Basic xyz"}',
            "{'password':'abc123'}",
            'cookie=session123 secret=abc123',
            'Authorization: Basic xyz',
            'Cookie: session123; token=abc123',
        ]:
            clean = sanitize(message)
            for secret in ("abc123", "Basic xyz", "session123"):
                self.assertNotIn(secret, clean)

    def test_wordpress_utc_log_timestamp(self):
        from hml_hosts import REMOTE
        with tempfile.TemporaryDirectory() as directory:
            nginx = Path(directory) / "nginx.log"
            wordpress = Path(directory) / "debug.log"
            nginx.write_text("")
            wordpress.write_text("[19-Nov-2026 13:43:20 UTC] PHP Fatal error: sample\n")
            files = {
                "/var/log/nginx/error.log": nginx,
                "/var/www/html/wordpress/wp-content/debug.log": wordpress,
            }
            with patch("pathlib.Path", side_effect=lambda name: files[name]), \
                 patch("subprocess.run", return_value=Mock(stdout="", returncode=0)), \
                 patch("builtins.print") as output:
                exec(REMOTE, {
                    "START": "2026-11-19T13:43:00+00:00",
                    "END": "2026-11-19T13:44:00+00:00",
                })
            result = json.loads(output.call_args.args[0])
            self.assertEqual(result["logs"][1]["status"], "ok")
            self.assertEqual(result["logs"][1]["events"][0]["category"], "php_fatal")

    def test_historical_metrics_keep_original_instances(self):
        from diagnose_hml import historical_topology
        client = FixtureAws()
        current = discover(client, "current")
        current["asg"]["AutoScalingGroupName"] = "TESTE-WP"
        old = "i-0123456789abcdef0"
        manifest = {"instance_ids": [old]}
        client.responses[("ec2", "describe-instances")] = {"Reservations": [{"Instances": [{
            "InstanceId": old, "VpcId": "vpc-hml",
        }]}]}
        with patch.object(client, "call", wraps=client.call) as calls:
            historical = historical_topology(client, manifest, current)
            self.assertEqual(historical["instances"][0]["InstanceId"], old)
            self.assertEqual(current["instances"][0]["InstanceId"], "i-hml")
            filters = calls.call_args.kwargs["filters"]
            self.assertIn({"Name": "tag:aws:autoscaling:groupName", "Values": ["TESTE-WP"]}, filters)

    def test_missing_historical_members_are_explicit(self):
        from diagnose_hml import historical_topology
        client = FixtureAws()
        current = discover(client, "current")
        current["asg"]["AutoScalingGroupName"] = "TESTE-WP"
        client.responses[("ec2", "describe-instances")] = {"Reservations": []}
        old = "i-0123456789abcdef0"
        historical = historical_topology(client, {"instance_ids": [old]}, current)
        self.assertEqual(historical["instances"], [])
        self.assertEqual(historical["unavailable_historical_instances"], [old])

    def test_access_log_delivery_pending_and_s3_pagination(self):
        from hml_logs import alb_logs
        client = FixtureAws()
        topology = discover(client, "current")
        start = timestamp("2026-11-19T13:43:00Z")
        end = timestamp("2026-11-19T13:44:00Z")
        with patch.object(client, "call", side_effect=[
            {"Attributes": [{"Key": "access_logs.s3.enabled", "Value": "true"},
                            {"Key": "access_logs.s3.bucket", "Value": "hml-logs"}]},
            {"Contents": [], "NextContinuationToken": "page2"},
            {"Contents": []},
        ]) as calls:
            result = alb_logs(client, topology, start, end)
            self.assertEqual(result["status"], "no_data")
            self.assertEqual(result["data"]["coverage"], "delivery_pending")
            self.assertEqual(calls.call_args.kwargs["continuation_token"], "page2")

    def test_source_missing_group_and_access_denied(self):
        for message, status in [("ResourceNotFoundException", "unavailable"), ("AccessDenied", "error")]:
            def fail():
                raise RuntimeError(message)
            self.assertEqual(source(fail)["status"], status)


if __name__ == "__main__":
    unittest.main()
