#!/usr/bin/env bash
set -euo pipefail

# Consulta métricas do CloudWatch exclusivamente para recursos HML após um teste k6.
# Uso: ./scripts/cloudwatch-summary.sh [minutos_atras]
MINUTES="${1:-15}"
REGION="${AWS_REGION:-us-east-1}"
HML_INSTANCE_ID="i-02b29195a2fdaf1e7"
HML_ALB_DIM="app/Hml-Site-Azion/ffb14ee37a74405d"
HML_ELB_NAME="dev-sep-hml"

START=$(date -u -d "${MINUTES} minutes ago" +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "=== CloudWatch HML (${START} -> ${END}) ==="

echo "--- EC2 ${HML_INSTANCE_ID} CPUUtilization (Max/Avg) ---"
aws cloudwatch get-metric-statistics --region "$REGION" \
  --namespace "AWS/EC2" --metric-name "CPUUtilization" \
  --dimensions Name=InstanceId,Value="$HML_INSTANCE_ID" \
  --start-time "$START" --end-time "$END" --period 60 --statistics Average Maximum \
  --output json | jq '.Datapoints | sort_by(.Timestamp) | map({Timestamp, Avg: (.Average | round), Max: (.Maximum | round)})'

echo "--- CWAgent ${HML_INSTANCE_ID} mem_used_percent (Max) ---"
aws cloudwatch get-metric-statistics --region "$REGION" \
  --namespace "CWAgent" --metric-name "mem_used_percent" \
  --dimensions Name=InstanceId,Value="$HML_INSTANCE_ID" \
  --start-time "$START" --end-time "$END" --period 60 --statistics Maximum \
  --output json | jq '.Datapoints | sort_by(.Timestamp) | map({Timestamp, MaxMemPct: .Maximum})'

echo "--- Classic ELB ${HML_ELB_NAME} RequestCount / Latency / Backend 5XX ---"
for metric in RequestCount Latency HTTPCode_Backend_5XX HTTPCode_Backend_2XX; do
  stat="Sum"
  [[ "$metric" == "Latency" ]] && stat="Average"
  echo "Metric: $metric ($stat)"
  aws cloudwatch get-metric-statistics --region "$REGION" \
    --namespace "AWS/ELB" --metric-name "$metric" \
    --dimensions Name=LoadBalancerName,Value="$HML_ELB_NAME" \
    --start-time "$START" --end-time "$END" --period 60 --statistics "$stat" \
    --output json | jq '.Datapoints | sort_by(.Timestamp)'
done

echo "--- ALB ${HML_ALB_DIM} RequestCount ---"
aws cloudwatch get-metric-statistics --region "$REGION" \
  --namespace "AWS/ApplicationELB" --metric-name "RequestCount" \
  --dimensions Name=LoadBalancer,Value="$HML_ALB_DIM" \
  --start-time "$START" --end-time "$END" --period 60 --statistics Sum \
  --output json | jq '.Datapoints | sort_by(.Timestamp)'
