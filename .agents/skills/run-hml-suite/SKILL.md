---
name: run-hml-suite
description: Executa os cenarios k6 exclusivamente em HML e correlaciona telemetria com CloudWatch e SSM.
---

# Execucao Controlada em HML

1. Confirme os recursos operacionais de HML antes de qualquer teste executando `make obs-recon`.
2. A topologia padrao e `HML_TOPOLOGY=current` (ALB `teste-multi-proxy` e ASG `TESTE-WP`). O alvo `TARGET=alb` e o ponto de entrada direto e validado para contornar instabilidades de borda na Azion.
3. Para validacao rapida de saude da aplicacao em HML, utilize:
   - `make test-smoke TARGET=alb` (recomendado para validacao direta no ALB com TLS valido).
   - `make test-smoke TARGET=ec2` (validacao direta em no saudavel do ASG via tunel SSM na porta 8083).
   - `make test-smoke TARGET=azion` (validacao passando pela borda Azion).
4. Para simulacao simultanea calibrada da torcida (personas iniciando em `0s`), execute com autorizacao explicita:
   `make test-fanbase TARGET=alb ALLOW_FANBASE_LOAD=true SCALE_FACTOR=0.4 RAMP_UP=5s HOLD=15s RAMP_DOWN=5s`.
5. Para diagnostico de timeout e lock de sessao HTTP 504:
   `make test-504 MODE=compare` (compara automaticamente EC2 direto, ALB e Azion Edge).
6. Apos qualquer execucao, correlacione o periodo com `make obs-collect RUN=reports/runs/<ID>.json` ou `make obs-collect CW_MINUTES=15`.
