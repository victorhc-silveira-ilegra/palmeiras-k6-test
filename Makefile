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
	hml-azion-smoke hml-ab-504 hml-4way-504 hml-session-lock hml-fanbase fanbase-hml \
	hml-run hml-recon hml-cw hml-monitor hml-watch hml-heavy-probe hml-anti-prod docker-up docker-smoke docker-fanbase \
	docker-rebuild docker-down docker-clean docker-restart docker-ps docker-logs docker-sh

help:
	@echo -e "$(BLUE)========================================================================$(RESET)"
	@echo -e "$(GREEN)             PALMEIRAS K6 TEST (HML) - MENU DE AJUDA                    $(RESET)"
	@echo -e "$(BLUE)========================================================================$(RESET)"
	@echo -e "Uso: $(CYAN)make <comando>$(RESET)"
	@echo -e ""
	@echo -e "$(YELLOW)Node:$(RESET) $(NODE_BIN) | $(YELLOW)Python:$(RESET) $(PYTHON) | $(YELLOW)k6:$(RESET) $(K6_BIN) | $(YELLOW)Alvo:$(RESET) $(TARGET_ENV)"
	@echo -e ""
	@echo -e "$(YELLOW)App & Quality Gate:$(RESET)"
	@echo -e "  $(GREEN)app-lint$(RESET)           - Lint de tudo (TypeScript, Docker/Hadolint, GitHub/Actionlint, Scripts)"
	@echo -e "  $(GREEN)app-security$(RESET)       - Seguranca de tudo (TS/npm, Docker/Trivy, GitHub/Gitleaks, Scripts)"
	@echo -e "  $(GREEN)app-test$(RESET)           - Vitest 100% + k6 inspect + paridade CI/hooks (ou app-tests)"
	@echo -e "  $(GREEN)app-validate$(RESET)       - Validate de tudo (TS/JSON, Compose, GitHub, Scripts/bash -n)"
	@echo -e "  $(GREEN)app-build$(RESET)          - Build de tudo (tsc build, docker build --check, compileall)"
	@echo -e "  $(GREEN)app-ci$(RESET)             - Executa pipeline CI/CD completo com resumo (ou ci / all)"
	@echo -e "  $(GREEN)app-clean$(RESET)          - Limpa caches dist/, coverage/ e __pycache__"
	@echo -e "  $(GREEN)app-install$(RESET)        - Instala dependencias Node (npm install)"
	@echo -e "  $(GREEN)app-setup$(RESET)          - Bootstrap .env + npm install (+ pre-commit se houver git)"
	@echo -e "  $(GREEN)app-pre-commit$(RESET)     - Instala hooks (matriz CI, fail-fast)"
	@echo -e "  $(GREEN)app-pre-commit-run$(RESET) - Roda hooks em todos os arquivos"
	@echo -e ""
	@echo -e "$(YELLOW)HML k6 & AWS (Exclusivo HML):$(RESET)"
	@echo -e "  $(GREEN)hml-smoke$(RESET)          - Executa smoke test HML em $(TARGET_ENV) (ou smoke-hml)"
	@echo -e "  $(GREEN)hml-ec2-smoke$(RESET)      - Smoke direto na EC2 HML (TARGET_URL=$(TARGET_URL))"
	@echo -e "  $(GREEN)hml-azion-smoke$(RESET)    - Smoke passando pela Azion Edge (hmlverdao.palmeiras.com.br)"
	@echo -e "  $(GREEN)hml-ab-504$(RESET)         - Comparativo A/B (EC2 direto vs Azion Edge) + CloudWatch"
	@echo -e "  $(GREEN)hml-4way-504$(RESET)       - Comparativo 4-vias (ec2_direct, hml_alb, hml_classic_elb, azion_edge)"
	@echo -e "  $(GREEN)hml-session-lock$(RESET)   - Probe de trava de sessao pos-504 /wp-admin e admin-ajax"
	@echo -e "  $(GREEN)hml-heavy-probe$(RESET)    - Emulacao de acao pesada sincrona (HEAVY_PATH=/wp-admin/...)"
	@echo -e "  $(GREEN)hml-fanbase$(RESET)        - Simulacao de carga (BLOQUEADO sem ALLOW_FANBASE_LOAD=true)"
	@echo -e "  $(GREEN)hml-run$(RESET)            - Executa cenario especifico em HML (SCENARIO=$(SCENARIO))"
	@echo -e "  $(GREEN)hml-recon$(RESET)          - Inventario read-only AWS HML (scripts/recon-hml.sh)"
	@echo -e "  $(GREEN)hml-cw$(RESET)             - Telemetria integrada HML (CW + SSM + RDS) ultimos $(CW_MINUTES)m"
	@echo -e "  $(GREEN)hml-monitor$(RESET)        - Alias para telemetria profunda HML (CloudWatch, SSM EC2 e RDS)"
	@echo -e "  $(GREEN)hml-watch$(RESET)          - Live Watch continuo da telemetria durante testes (WATCH_INTERVAL=5)"
	@echo -e "  $(GREEN)hml-anti-prod$(RESET)      - Teste negativo: confirma bloqueio imediato de prod_alb"
	@echo -e ""
	@echo -e "$(YELLOW)Docker:$(RESET)"
	@echo -e "  $(GREEN)docker-up$(RESET)          - Sobe o servico k6 em container (SCENARIO=$(SCENARIO))"
	@echo -e "  $(GREEN)docker-smoke$(RESET)       - Executa smoke.ts em HML dentro do container (--rm)"
	@echo -e "  $(GREEN)docker-fanbase$(RESET)     - Executa fanbase_simul.ts em HML no container preservando reports/"
	@echo -e "  $(GREEN)docker-rebuild$(RESET)     - Rebuild da imagem (--pull) e recria o container"
	@echo -e "  $(GREEN)docker-down$(RESET)        - Para o container preservando reports/"
	@echo -e "  $(GREEN)docker-clean$(RESET)       - $(RED)DESTRUTIVO$(RESET): remove containers, redes e imagem local"
	@echo -e "  $(GREEN)docker-restart$(RESET)     - Restart do servico palmeiras-k6"
	@echo -e "  $(GREEN)docker-ps$(RESET)          - Status dos containers"
	@echo -e "  $(GREEN)docker-logs$(RESET)        - Segue INFO (F=0 uma vez; LEVEL=all todos; T=1; P=1)"
	@echo -e "  $(GREEN)docker-sh$(RESET)          - Shell /bin/sh no container palmeiras-k6"
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
	TARGET_ENV=$(TARGET_ENV) $(K6_BIN) run -e TARGET_ENV=$(TARGET_ENV) -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/smoke.ts

hml-ec2-smoke:
	$(K6_BIN) run -e TARGET_ENV=hml_ec2_direct -e TARGET_URL="$(TARGET_URL)" -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/smoke.ts

hml-azion-smoke:
	$(K6_BIN) run -e TARGET_ENV=azion_edge -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" src/presentation/scenarios/smoke.ts

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
