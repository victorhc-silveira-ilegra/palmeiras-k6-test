# Engenharia de Infraestrutura e Contêineres

Especificações técnicas de empacotamento e execução do **Palmeiras K6 Test (HML)** em contêiner Docker.

## 1. Topologia de Execução e Rede

O contêiner utiliza a imagem oficial `grafana/k6:latest` empacotada pelo [Dockerfile](../infra/docker/Dockerfile) em `infra/docker/` (governado por [.hadolint.yaml](../infra/docker/.hadolint.yaml)):

- **Alvo Padrão Isolado para HML**: A imagem define `ENV TARGET_ENV=hml_classic_elb`, mantendo a política estrita anti-PROD tanto no ambiente do contêiner quanto no núcleo de domínio (`TargetEnvironment`).
- **Conectividade de Saída**: Opera com rede padrão bridge ou host conforme necessidade da estação de testes para alcançar o Classic ELB público `dev-sep-hml-160178191.us-east-1.elb.amazonaws.com` (ou borda/VPC em execuções autorizadas).
- **Persistência de Relatórios**: A montagem de volume para `/app/reports` preserva no host os resumos HTML e JSON produzidos pelo `K6ReporterAdapter`.

## 2. Estrutura de Empacotamento (`Dockerfile`)

O [Dockerfile](../infra/docker/Dockerfile) copia apenas os artefatos necessários para execução em runtime pelo `k6`:

| Caminho no Host | Caminho no Contêiner | Finalidade |
| :--- | :--- | :--- |
| `data/` | `/app/data` | Datasets reais de HML (`hml-dataset.json`, `fanbase-model.json`) |
| `src/` | `/app/src` | Código TypeScript hexagonal consumido diretamente pelo `k6` |
| `.env.example` | `/app/.env.example` | Referência de parâmetros padrão de runtime |
| `$(pwd)/reports` (volume em runtime) | `/app/reports` | Gravação dos relatórios HTML e JSON gerados após cada cenário |

## 3. Comandos e Verificação via Docker Compose e Makefile

A orquestração via [docker-compose.yml](../infra/docker/docker-compose.yml) preserva o mapeamento `./reports:/app/reports` e a injeção segura do `.env`:

```bash
# Validação sintática e de composição (Estágio 4 e 5 do Quality Gate)
docker build --check -f infra/docker/Dockerfile .
docker compose --env-file .env.example -f infra/docker/docker-compose.yml --project-directory . config -q

# Ciclo de vida padronizado via Makefile
make docker-smoke       # Smoke test HML em contêiner efêmero (--rm)
make docker-fanbase     # Simulação simultânea da torcida em HML preservando reports/
make docker-up          # Inicializa serviço palmeiras-k6 em segundo plano (SCENARIO=smoke)
make docker-logs        # Logs filtrados INFO (LEVEL=all / F=0 / T=1 / P=1)
make docker-ps          # Status do serviço
make docker-restart     # Reinicia o contêiner
make docker-rebuild     # Rebuild da imagem e recriação do serviço
make docker-sh          # Abre shell /bin/sh no contêiner
make docker-down        # Encerra o serviço preservando reports/
make docker-clean       # Remove containers, redes e imagem local
```

## 4. Teste Negativo Obrigatório (Invariante Anti-PROD)

Qualquer tentativa de sobrepor `TARGET_ENV` para produção durante a execução do contêiner é interrompida na inicialização do script:

```bash
docker run --rm -e TARGET_ENV=prod_alb palmeiras-k6-hml:local inspect src/presentation/scenarios/smoke.ts
```

A execução deve encerrar com erro contendo `ABORTADO [ANTI-PROD]: Alvo proibido detectado em TARGET_ENV: "prod_alb"`.
