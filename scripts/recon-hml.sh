#!/usr/bin/env bash
set -euo pipefail

# Recon AWS estritamente SOMENTE LEITURA e filtrado para HML (proibido PROD).
REGION="${AWS_REGION:-us-east-1}"

echo "=== Identidade AWS ==="
aws sts get-caller-identity --output json

echo "=== Load Balancers HML (ALB) ==="
aws elbv2 describe-load-balancers --region "$REGION" --output json \
  | jq '[.LoadBalancers[] | select((.LoadBalancerName | test("hml|hlg|homol"; "i")) and (.LoadBalancerName | test("prod"; "i") | not)) | {LoadBalancerName, DNSName, Scheme, VpcId, SecurityGroups}]'

echo "=== Load Balancers HML (Classic ELB) ==="
aws elb describe-load-balancers --region "$REGION" --output json \
  | jq '[.LoadBalancerDescriptions[] | select((.LoadBalancerName | test("hml|hlg|homol"; "i")) and (.LoadBalancerName | test("prod"; "i") | not)) | {LoadBalancerName, DNSName, Instances, ListenerDescriptions}]'

echo "=== Instâncias EC2 HML ==="
aws ec2 describe-instances --region "$REGION" --output json \
  | jq '[.Reservations[].Instances[] | {InstanceId, InstanceType, State: .State.Name, PrivateIpAddress, PublicIpAddress, Name: ((.Tags // [])[]? | select(.Key=="Name") | .Value)} | select(((.Name // "") | test("hml|hlg|homol"; "i")) and ((.Name // "") | test("prod"; "i") | not))]'

echo "=== Target Health palmeiras-tg-hml ==="
TG_ARN=$(aws elbv2 describe-target-groups --names "palmeiras-tg-hml" --region "$REGION" --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN" --region "$REGION" --output json \
  | jq '.TargetHealthDescriptions'

echo "=== Alarmes CloudWatch HML ==="
aws cloudwatch describe-alarms --region "$REGION" --output json \
  | jq '[.MetricAlarms[] | select((.AlarmName | test("hml|hlg|homol"; "i")) and (.AlarmName | test("prod"; "i") | not)) | {AlarmName, MetricName, StateValue}]'
