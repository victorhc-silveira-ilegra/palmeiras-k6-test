# Infraestrutura (`infra/`)

Documentação dos artefatos de empacotamento em contêiner e automação de observabilidade AWS HML do **Palmeiras K6 Test (HML)**.

## Artefatos Relacionados

- [docker/Dockerfile](docker/Dockerfile): Imagem baseada em `grafana/k6:latest` empacotando `data/`, `src/` e `.env.example` com variável padrão `TARGET_ENV=hml_classic_elb`.
- [docker/.hadolint.yaml](docker/.hadolint.yaml): Política Hadolint aplicada ao `Dockerfile` no estágio `Docker | Lint`.
- [docker/docker-compose.yml](docker/docker-compose.yml): Definição de serviço `palmeiras-k6` usada pelos alvos `make docker-*`, com montagem de `./reports:/app/reports`.
- [scripts/recon-hml.sh](../scripts/recon-hml.sh): Levantamento somente leitura da topologia AWS em HML (`us-east-1`, conta `000491796368`).
- [scripts/cloudwatch-summary.sh](../scripts/cloudwatch-summary.sh): Correlação automática entre métricas de carga do `k6` e telemetria CloudWatch em HML.

Para instruções completas de build, volume de relatórios e execução em contêiner, consulte [docs/infra-docker.md](../docs/infra-docker.md).
