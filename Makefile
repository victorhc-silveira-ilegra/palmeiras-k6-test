SHELL := /bin/bash
DOCKER_COMPOSE=docker compose --env-file .env -f infra/docker/docker-compose.yml --project-directory .
DOCKER_LOGS_TAIL ?= 200
DOCKER_LOGS_SERVICES ?= palmeiras-k6
LEVEL ?= INFO

RESOLVE_PY := $(shell bash linters/git-hooks/bin/resolve_venv_python.sh 2>/dev/null || echo python3)
PYTHON := $(RESOLVE_PY)
NODE_BIN := $(shell which node 2>/dev/null || echo node)
K6_BIN := $(shell which k6 2>/dev/null || echo k6)
ORCHESTRATOR := scripts/operations/clean_workspace.py

TARGET_ENV ?= hml_classic_elb
TARGET_URL ?=
REQUEST_TIMEOUT ?=
SCENARIO ?= smoke
SCALE_FACTOR ?= 0.4
RAMP_UP ?= 5s
HOLD ?= 15s
RAMP_DOWN ?= 5s
ALLOW_FANBASE_LOAD ?= false
WP_AUTH_COOKIE ?=
WP_NONCE ?=
WP_AJAX_ACTION ?= heartbeat
WP_ADMIN_PATH ?= /wp-admin/
HEAVY_PATH ?=
CW_MINUTES ?= 15
WATCH_INTERVAL ?= 5

GREEN  := \033[1;32m
YELLOW := \033[1;33m
BLUE   := \033[1;34m
CYAN   := \033[1;36m
RED    := \033[1;31m
RESET  := \033[0m

.DEFAULT_GOAL := help

.PHONY: help app-install install app-lint lint app-security security app-test app-tests test \
	app-validate validate app-build build app-ci ci all app-clean clean app-setup \
	app-pre-commit hooks app-pre-commit-run hml-smoke smoke-hml hml-ec2-smoke \
	hml-azion-smoke hml-multi-proxy-smoke hml-ab-504 hml-4way-504 hml-session-lock hml-fanbase fanbase-hml hml-azion-fanbase \
	hml-run hml-recon hml-cw hml-monitor hml-watch hml-heavy-probe hml-anti-prod docker-up docker-smoke docker-fanbase \
	docker-rebuild docker-down docker-clean docker-restart docker-ps docker-logs docker-sh

help:
	@echo -e "$(BLUE)========================================================================$(RESET)"
	@echo -e "$(GREEN)             PALMEIRAS K6 TEST (HML) - MENU DE AJUDA                    $(RESET)"
	@echo -e "$(BLUE)========================================================================$(RESET)"
	@echo -e "Uso: $(CYAN)make <comando>$(RESET)"
	@echo -e ""
	@echo -e "$(YELLOW)Node:$(RESET) $(NODE_BIN) | $(YELLOW)Python:$(RESET) $(PYTHON) | $(YELLOW)k6:$(RESET) $(K6_BIN)"
	@echo -e ""
	@echo -e "$(YELLOW)Aplicação e qualidade$(RESET)"
	@echo -e "    $(GREEN)app-install$(RESET)          - Instala as dependências Node.js (alias: install)"
	@echo -e "    $(GREEN)app-setup$(RESET)            - Cria .env e o ambiente Python se faltarem, instala dependências Node.js e configura hooks Git"
	@echo -e "    $(GREEN)app-pre-commit$(RESET)       - Instala os hooks Git de validação (alias: hooks)"
	@echo -e "    $(GREEN)app-pre-commit-run$(RESET)   - Executa os hooks de pre-commit em todos os arquivos"
	@echo -e "    $(GREEN)app-ci$(RESET)               - Executa as cinco etapas da matriz de qualidade e exibe o resumo (aliases: ci, all)"
	@echo -e "    $(GREEN)app-lint$(RESET)             - Verifica tipagem, estilo e convenções em TypeScript, Docker, GitHub Actions e scripts (alias: lint)"
	@echo -e "    $(GREEN)app-security$(RESET)         - Audita dependências, imagens e scripts e busca segredos no repositório (alias: security)"
	@echo -e "    $(GREEN)app-test$(RESET)             - Executa Vitest com cobertura, inspeciona cenários k6 e verifica paridade entre CI e hooks (aliases: app-tests, test)"
	@echo -e "    $(GREEN)app-validate$(RESET)         - Valida arquivos JSON e YAML, configuração do Compose e sintaxe dos scripts (alias: validate)"
	@echo -e "    $(GREEN)app-build$(RESET)            - Verifica a compilação TypeScript e Python e a configuração de build Docker (alias: build)"
	@echo -e "    $(GREEN)app-clean$(RESET)            - Remove artefatos de compilação, relatórios de cobertura e caches Python (alias: clean)"
	@echo -e ""
	@echo -e "$(YELLOW)Homologação (k6 e AWS)$(RESET)"
	@echo -e "    $(GREEN)hml-azion-smoke$(RESET)      - Executa a verificação básica do WordPress de HML pela Azion (REQUEST_TIMEOUT padrão de 3s)"
	@echo -e "    $(GREEN)hml-multi-proxy-smoke$(RESET) - Executa o mesmo smoke direto no ALB atual, com TLS validado"
	@echo -e "    $(GREEN)hml-azion-fanbase$(RESET)    - Simula a torcida pela Azion com escala, rampa e autorização de carga explícitas"
	@echo -e "    $(GREEN)hml-run$(RESET)              - Executa o cenário definido em SCENARIO no alvo indicado por TARGET_ENV"
	@echo -e "    $(GREEN)hml-smoke$(RESET)            - Executa a verificação básica no alvo indicado por TARGET_ENV (REQUEST_TIMEOUT padrão de 3s, alias: smoke-hml)"
	@echo -e "    $(GREEN)hml-ec2-smoke$(RESET)        - Executa a verificação básica diretamente na EC2 de HML indicada por TARGET_URL"
	@echo -e "    $(GREEN)hml-fanbase$(RESET)          - Simula a torcida no alvo selecionado com ALLOW_FANBASE_LOAD=true (alias: fanbase-hml)"
	@echo -e "    $(GREEN)hml-cw-multi-proxy$(RESET)   - Consulta volume, latência e erros do ALB teste-multi-proxy (CW_MINUTES=$(CW_MINUTES))"
	@echo -e "    $(GREEN)hml-recon$(RESET)            - Consulta o inventário AWS da topologia original de HML"
	@echo -e "    $(GREEN)hml-cw$(RESET)               - Coleta métricas e logs da topologia original via CloudWatch e SSM (CW_MINUTES=$(CW_MINUTES), alias: hml-monitor)"
	@echo -e "    $(GREEN)hml-watch$(RESET)            - Acompanha ao vivo a telemetria da topologia original (WATCH_INTERVAL=$(WATCH_INTERVAL)s)"
	@echo -e "    $(GREEN)hml-ab-504$(RESET)           - Compara respostas e latência entre a EC2 direta e a Azion e coleta métricas do CloudWatch"
	@echo -e "    $(GREEN)hml-4way-504$(RESET)         - Compara timeouts via EC2, ALB original, Classic ELB e Azion"
	@echo -e "    $(GREEN)hml-session-lock$(RESET)     - Compara a resposta da mesma sessão após timeout com a de um controle sem cookie"
	@echo -e "    $(GREEN)hml-heavy-probe$(RESET)      - Mede a resposta de uma ação síncrona do WordPress indicada por HEAVY_PATH"
	@echo -e "    $(GREEN)hml-anti-prod$(RESET)        - Confirma com k6 inspect que a configuração rejeita um alvo de produção"
	@echo -e ""
	@echo -e "$(YELLOW)Docker$(RESET)"
	@echo -e "    $(GREEN)docker-up$(RESET)            - Inicia o serviço k6 em segundo plano com o cenário selecionado (SCENARIO=$(SCENARIO))"
	@echo -e "    $(GREEN)docker-rebuild$(RESET)       - Reconstrói a imagem com atualização da base e recria o serviço"
	@echo -e "    $(GREEN)docker-restart$(RESET)       - Reinicia o serviço palmeiras-k6"
	@echo -e "    $(GREEN)docker-down$(RESET)          - Encerra o serviço e mantém os relatórios em reports/"
	@echo -e "    $(GREEN)docker-smoke$(RESET)         - Executa o smoke de HML em um contêiner descartável"
	@echo -e "    $(GREEN)docker-fanbase$(RESET)       - Simula a torcida em contêiner e grava os relatórios em reports/"
	@echo -e "    $(GREEN)docker-ps$(RESET)            - Exibe o estado dos contêineres do projeto"
	@echo -e "    $(GREEN)docker-logs$(RESET)          - Acompanha logs INFO (LEVEL=all para todos os níveis, F=0 para consulta única)"
	@echo -e "    $(GREEN)docker-sh$(RESET)            - Abre um shell no serviço k6 ou inicia um contêiner temporário"
	@echo -e "    $(GREEN)docker-clean$(RESET)         - $(RED)DESTRUTIVO$(RESET) — remove contêineres, redes e a imagem local"
	@echo -e ""
	@echo -e "$(BLUE)========================================================================$(RESET)"

app-install install:
	npm install --no-audit --no-fund

app-lint lint:
	$(PYTHON) $(ORCHESTRATOR) --stage lint

app-security security:
	$(PYTHON) $(ORCHESTRATOR) --stage security

app-test app-tests test:
	$(PYTHON) $(ORCHESTRATOR) --stage test

app-validate validate:
	$(PYTHON) $(ORCHESTRATOR) --stage validate

app-build build:
	$(PYTHON) $(ORCHESTRATOR) --stage build

app-ci ci all:
	$(PYTHON) $(ORCHESTRATOR) --stage pipeline

app-clean clean:
	$(PYTHON) $(ORCHESTRATOR) --stage clean

app-setup:
	@test -f .env || cp .env.example .env
	@test -d .venv || python3 -m venv .venv
	npm install --no-audit --no-fund
	@$(MAKE) app-pre-commit

app-pre-commit hooks:
	bash linters/git-hooks/install.sh
	chmod +x linters/git-hooks/bin/resolve_venv_python.sh linters/git-hooks/bin/python \
		linters/git-hooks/bin/pre-commit linters/git-hooks/commitlint.sh linters/git-hooks/commit-msg \
		linters/git-hooks/pre-commit .githooks/pre-commit .githooks/commit-msg $(ORCHESTRATOR) \
		scripts/recon-hml.sh scripts/cloudwatch-summary.sh

app-pre-commit-run:
	$(PYTHON) -m pre_commit run --all-files -c .pre-commit-config.yaml

hml-smoke smoke-hml:
	TARGET_ENV=$(TARGET_ENV) $(K6_BIN) run -e TARGET_ENV=$(TARGET_ENV) -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(or $(strip $(REQUEST_TIMEOUT)),3s)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/smoke.ts

hml-ec2-smoke:
	$(K6_BIN) run -e TARGET_ENV=hml_ec2_direct -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/smoke.ts

hml-azion-smoke:
	$(K6_BIN) run -e TARGET_ENV=azion_edge -e TARGET_URL= -e SMOKE_MULTI_PROXY_IP= -e REQUEST_TIMEOUT="$(or $(strip $(REQUEST_TIMEOUT)),3s)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/smoke.ts

hml-multi-proxy-smoke:
	@set -euo pipefail; \
	account=$$(aws sts get-caller-identity --region us-east-1 --query Account --output text --no-cli-pager); \
	if [[ "$$account" != 000491796368 ]]; then echo "Conta AWS diferente da conta de HML." >&2; exit 1; fi; \
	dns=$$(aws elbv2 describe-load-balancers --region us-east-1 --names teste-multi-proxy --query 'LoadBalancers[0].DNSName' --output text --no-cli-pager); \
	if [[ "$$dns" != teste-multi-proxy-*.us-east-1.elb.amazonaws.com ]]; then echo "DNS inesperado para o ALB de HML." >&2; exit 1; fi; \
	ip=$$(getent ahostsv4 "$$dns" | awk 'NR == 1 {print $$1}'); \
	if [[ -z "$$ip" ]]; then echo "ALB de HML sem IPv4 resolvido." >&2; exit 1; fi; \
	$(K6_BIN) run -e TARGET_ENV=azion_edge -e TARGET_URL= -e SMOKE_MULTI_PROXY_IP="$$ip" -e REQUEST_TIMEOUT="$(or $(strip $(REQUEST_TIMEOUT)),3s)" src/presentation/scenarios/smoke.ts

hml-ab-504:
	@echo -e "$(CYAN)[1/3] Executando diagnostico direto na EC2 (hml_ec2_direct)...$(RESET)"
	-$(K6_BIN) run -e TARGET_ENV=hml_ec2_direct -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/cache_bypass.ts
	@echo -e "$(CYAN)[2/3] Executando diagnostico via Azion Edge (azion_edge)...$(RESET)"
	-$(K6_BIN) run -e TARGET_ENV=azion_edge -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/cache_bypass.ts
	@echo -e "$(CYAN)[3/3] Coletando telemetria CloudWatch HML...$(RESET)"
	bash scripts/cloudwatch-summary.sh $(CW_MINUTES)

hml-4way-504:
	@echo -e "$(CYAN)[1/5] Hop 1: Bypass Direto na EC2 (ec2_direct)...$(RESET)"
	-$(K6_BIN) run -e TARGET_ENV=ec2_direct -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" -e HEAVY_PATH="$(HEAVY_PATH)" src/presentation/scenarios/heavy_sync_probe.ts
	@echo -e "$(CYAN)[2/5] Hop 2: ALB Azion com idle_timeout=60s (hml_alb)...$(RESET)"
	-$(K6_BIN) run -e TARGET_ENV=hml_alb -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" -e HEAVY_PATH="$(HEAVY_PATH)" src/presentation/scenarios/heavy_sync_probe.ts
	@echo -e "$(CYAN)[3/5] Hop 3: Classic ELB com IdleTimeout=75s (hml_classic_elb)...$(RESET)"
	-$(K6_BIN) run -e TARGET_ENV=hml_classic_elb -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" -e HEAVY_PATH="$(HEAVY_PATH)" src/presentation/scenarios/heavy_sync_probe.ts
	@echo -e "$(CYAN)[4/5] Hop 4: Borda Azion Edge (azion_edge)...$(RESET)"
	-$(K6_BIN) run -e TARGET_ENV=azion_edge -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" -e HEAVY_PATH="$(HEAVY_PATH)" src/presentation/scenarios/heavy_sync_probe.ts
	@echo -e "$(CYAN)[5/5] Coleta de Telemetria Integrada HML...$(RESET)"
	bash scripts/cloudwatch-summary.sh 5

hml-session-lock:
	$(K6_BIN) run -e TARGET_ENV=$(TARGET_ENV) -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/race_conditions.ts

hml-heavy-probe:
	$(K6_BIN) run -e TARGET_ENV=$(TARGET_ENV) -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" -e HEAVY_PATH="$(HEAVY_PATH)" src/presentation/scenarios/heavy_sync_probe.ts

hml-azion-fanbase:
	$(foreach param,SCALE_FACTOR RAMP_UP HOLD RAMP_DOWN,$(if $(and $(filter command line environment,$(origin $(param))),$(strip $($(param)))),,$(error Informe $(param) explicitamente para hml-azion-fanbase)))
	$(if $(filter true,$(ALLOW_FANBASE_LOAD)),,$(error Use ALLOW_FANBASE_LOAD=true para hml-azion-fanbase))
	$(MAKE) hml-fanbase TARGET_ENV=azion_edge TARGET_URL=

hml-fanbase fanbase-hml:
	@if [ "$(ALLOW_FANBASE_LOAD)" != "true" ]; then echo -e "$(RED)ABORTADO [PROTECAO]: fanbase_simul e teste de carga. Use ALLOW_FANBASE_LOAD=true explicitamente.$(RESET)"; exit 1; fi
	TARGET_ENV=$(TARGET_ENV) $(K6_BIN) run -e TARGET_ENV=$(TARGET_ENV) -e ALLOW_FANBASE_LOAD=$(ALLOW_FANBASE_LOAD) -e RAMP_UP=$(RAMP_UP) -e HOLD=$(HOLD) -e RAMP_DOWN=$(RAMP_DOWN) -e SCALE_FACTOR=$(SCALE_FACTOR) src/presentation/scenarios/fanbase_simul.ts

hml-run:
	TARGET_ENV=$(TARGET_ENV) $(K6_BIN) run -e TARGET_ENV=$(TARGET_ENV) -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/$(SCENARIO).ts

hml-recon:
	bash scripts/recon-hml.sh

hml-cw:
	bash scripts/cloudwatch-summary.sh $(CW_MINUTES)

hml-monitor: hml-cw

hml-watch:
	bash scripts/cloudwatch-summary.sh --watch --interval $(WATCH_INTERVAL)

hml-anti-prod:
	@OUT=$$($(K6_BIN) inspect -e TARGET_ENV=prod_alb src/presentation/scenarios/smoke.ts 2>&1 || true); \
	echo "$$OUT"; \
	echo "$$OUT" | grep -q "ABORTADO \[ANTI-PROD\]" || { echo "ERRO: trava anti-PROD nao disparou"; exit 1; }

docker-up:
	@test -f .env || cp .env.example .env
	SCENARIO=$(SCENARIO) TARGET_ENV=$(TARGET_ENV) $(DOCKER_COMPOSE) up -d --build

docker-smoke:
	@test -f .env || cp .env.example .env
	TARGET_ENV=$(TARGET_ENV) $(DOCKER_COMPOSE) run --rm palmeiras-k6 run src/presentation/scenarios/smoke.ts

docker-fanbase:
	@if [ "$(ALLOW_FANBASE_LOAD)" != "true" ]; then echo -e "$(RED)ABORTADO [PROTECAO]: fanbase_simul e teste de carga. Use ALLOW_FANBASE_LOAD=true explicitamente.$(RESET)"; exit 1; fi
	@test -f .env || cp .env.example .env
	TARGET_ENV=$(TARGET_ENV) ALLOW_FANBASE_LOAD=$(ALLOW_FANBASE_LOAD) RAMP_UP=$(RAMP_UP) HOLD=$(HOLD) RAMP_DOWN=$(RAMP_DOWN) SCALE_FACTOR=$(SCALE_FACTOR) $(DOCKER_COMPOSE) run --rm palmeiras-k6 run src/presentation/scenarios/fanbase_simul.ts

docker-rebuild:
	@test -f .env || cp .env.example .env
	@echo -e "$(YELLOW)Rebuild da imagem e recriacao do container$(RESET)"
	$(DOCKER_COMPOSE) build --pull
	SCENARIO=$(SCENARIO) TARGET_ENV=$(TARGET_ENV) $(DOCKER_COMPOSE) up -d --force-recreate --remove-orphans
	@$(DOCKER_COMPOSE) ps

docker-down:
	@test -f .env || cp .env.example .env
	$(DOCKER_COMPOSE) down

docker-clean:
	@test -f .env || cp .env.example .env
	@echo -e "$(RED)Removendo containers, redes e imagem local$(RESET)"
	$(DOCKER_COMPOSE) down --volumes --remove-orphans --rmi local
	@$(DOCKER_COMPOSE) ps

docker-restart:
	@test -f .env || cp .env.example .env
	$(DOCKER_COMPOSE) restart

docker-ps:
	@test -f .env || cp .env.example .env
	$(DOCKER_COMPOSE) ps

docker-logs: F ?= 1
docker-logs:
	@test -f .env || cp .env.example .env
ifeq ($(filter all ALL,$(LEVEL)),)
	$(DOCKER_COMPOSE) logs --tail=$(DOCKER_LOGS_TAIL) $(if $(P),,--no-log-prefix) $(if $(T),--timestamps,) $(if $(filter 1,$(F)),-f,) $(if $(DOCKER_SERVICE),$(DOCKER_SERVICE),$(DOCKER_LOGS_SERVICES)) | grep --line-buffered -E '"level":"INFO"|k6\.cycle|status=' || true
else
	$(DOCKER_COMPOSE) logs --tail=$(DOCKER_LOGS_TAIL) $(if $(P),,--no-log-prefix) $(if $(T),--timestamps,) $(if $(filter 1,$(F)),-f,) $(if $(DOCKER_SERVICE),$(DOCKER_SERVICE),$(DOCKER_LOGS_SERVICES))
endif

docker-sh:
	@test -f .env || cp .env.example .env
	@echo -e "$(CYAN)Abrindo /bin/sh em '$(or $(DOCKER_SERVICE),palmeiras-k6)'$(RESET)"
	$(DOCKER_COMPOSE) exec $(or $(DOCKER_SERVICE),palmeiras-k6) /bin/sh || $(DOCKER_COMPOSE) run --rm --entrypoint /bin/sh $(or $(DOCKER_SERVICE),palmeiras-k6)

.PHONY: hml-cw-multi-proxy
hml-cw-multi-proxy:
	bash scripts/cloudwatch-multi-proxy.sh $(CW_MINUTES)
