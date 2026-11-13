#!/usr/bin/env bash
set -euo pipefail

region=us-east-1
account=000491796368
actual_account=$(aws sts get-caller-identity --region "$region" --query Account --output text --no-cli-pager)
if [[ "$actual_account" != "$account" ]]; then
  echo "Coleta abortada: a conta ativa não é a conta de HML." >&2
  exit 1
fi

alb_arn=$(aws elbv2 describe-load-balancers --region "$region" --names teste-multi-proxy \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text --no-cli-pager)
case "$alb_arn" in
  "arn:aws:elasticloadbalancing:$region:$account:loadbalancer/app/teste-multi-proxy/"*) ;;
  *) echo "Coleta abortada: ALB de HML não identificado." >&2; exit 1 ;;
esac

minutes="${1:-15}"
if [[ ! "$minutes" =~ ^[1-9][0-9]*$ ]]; then
  echo "Informe a janela de coleta em minutos inteiros positivos." >&2
  exit 1
fi
start=$(date -u -d "$minutes minutes ago" +%FT%TZ)
end=$(date -u +%FT%TZ)

for metric in RequestCount TargetResponseTime HTTPCode_ELB_504_Count HTTPCode_Target_5XX_Count; do
  statistic=Sum
  if [[ "$metric" == TargetResponseTime ]]; then
    statistic=Average
  fi
  aws cloudwatch get-metric-statistics --region "$region" --namespace AWS/ApplicationELB \
    --metric-name "$metric" --dimensions "Name=LoadBalancer,Value=${alb_arn#*loadbalancer/}" \
    --start-time "$start" --end-time "$end" --period 60 --statistics "$statistic" \
    --query '{Metrica:Label,Pontos:sort_by(Datapoints, &Timestamp)}' --output json --no-cli-pager
done
