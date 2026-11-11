---
name: run-hml-suite
description: Executa os cenarios k6 exclusivamente em HML e correlaciona telemetria com CloudWatch.
---

# Execucao Controlada em HML

1. Confirme que o alvo e HML (`TARGET_ENV=hml_classic_elb`) e valide o Quality Gate (`make test`).
2. Para validacao rapida de saude da aplicacao em HML, execute `TARGET_ENV=hml_classic_elb k6 run src/presentation/scenarios/smoke.ts`.
3. Para simulacao simultanea calibrada da torcida (100 por cento das personas iniciando em `0s`), execute `TARGET_ENV=hml_classic_elb k6 run -e RAMP_UP=5s -e HOLD=15s -e RAMP_DOWN=5s -e SCALE_FACTOR=0.4 src/presentation/scenarios/fanbase_simul.ts`.
4. Correlacione o periodo com `bash scripts/cloudwatch-summary.sh 15` e verifique os artefatos gerados em `reports/`.
