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

TARGET_ENV ?= azion_edge
HML_TOPOLOGY ?= current
export HML_TOPOLOGY
RUN ?=
AZION_LOG ?=
TARGET ?= azion
MODE ?= compare
STAGE ?= all
TEST ?= smoke
TEST_TARGET_ENV = $(if $(filter azion,$(TARGET)),azion_edge,$(if $(filter alb,$(TARGET)),hml_alb,$(if $(filter ec2,$(TARGET)),hml_ec2_direct,)))
OBS_RUN_ARGS = $(if $(strip $(RUN)),--run "$(RUN)",--minutes $(CW_MINUTES))
TARGET_URL ?=
SMOKE_PROFILE ?= functional
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
SMOKE_REQUEST_TIMEOUT = $(or $(strip $(REQUEST_TIMEOUT)),$(if $(filter strict,$(SMOKE_PROFILE)),3s,15s))
SMOKE_K6_ARGS = -e SMOKE_PROFILE="$(SMOKE_PROFILE)" -e REQUEST_TIMEOUT="$(SMOKE_REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)"
HML_RUNNER = python3 scripts/operations/run_hml.py --k6 "$(K6_BIN)"
HML_TEST_ARGS = -e REQUEST_TIMEOUT="$(REQUEST_TIMEOUT)" -e WP_AUTH_COOKIE="$(WP_AUTH_COOKIE)" -e WP_NONCE="$(WP_NONCE)" -e WP_AJAX_ACTION="$(WP_AJAX_ACTION)" -e WP_ADMIN_PATH="$(WP_ADMIN_PATH)" -e HEAVY_PATH="$(HEAVY_PATH)" -e ALLOW_FANBASE_LOAD="$(ALLOW_FANBASE_LOAD)" -e SCALE_FACTOR="$(SCALE_FACTOR)" -e RAMP_UP="$(RAMP_UP)" -e HOLD="$(HOLD)" -e RAMP_DOWN="$(RAMP_DOWN)"
HML_COMPARE_TARGETS = $(if $(filter legacy,$(HML_TOPOLOGY)),hml_ec2_direct hml_alb hml_classic_elb azion_edge,hml_ec2_direct hml_alb azion_edge)
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
	hml-run hml-diagnose hml-recon hml-cw hml-monitor hml-watch hml-heavy-probe hml-anti-prod docker-up docker-smoke docker-fanbase \
	docker-rebuild docker-down docker-clean docker-restart docker-ps docker-logs docker-sh

help:
	@echo -e "$(BLUE)========================================================================$(RESET)"
	@echo -e "$(GREEN)             PALMEIRAS K6 TEST (HML) - MENU DE AJUDA                    $(RESET)"
	@echo -e "$(BLUE)========================================================================$(RESET)"
	@echo -e "Uso: $(CYAN)make <comando>$(RESET)"
	@echo -e ""
	@echo -e "$(YELLOW)Node:$(RESET) $(NODE_BIN) | $(YELLOW)Python:$(RESET) $(PYTHON) | $(YELLOW)k6:$(RESET) $(K6_BIN)"
	@echo -e ""
	@echo -e "$(YELLOW)APP$(RESET)"
	@echo -e "  $(GREEN)app-setup$(RESET)         - Prepara .env, dependências e hooks (alias: app-start)"
	@echo -e "  $(GREEN)app-ci$(RESET)            - Executa todos os gates locais de qualidade"
	@echo -e "  $(GREEN)app-gate$(RESET)          - Executa STAGE=lint, security, test, validate, build ou all"
	@echo -e "  $(GREEN)app-hooks$(RESET)         - Executa pre-commit em todos os arquivos"
	@echo -e "  $(GREEN)app-clean$(RESET)         - Remove artefatos e caches locais"
	@echo -e ""
	@echo -e "$(YELLOW)Testes de HML$(RESET)"
	@echo -e "  $(GREEN)test-smoke$(RESET)        - Valida TARGET=azion, alb, ec2 ou all (SMOKE_PROFILE=functional ou strict)"
	@echo -e "  $(GREEN)test-fanbase$(RESET)      - Simula a torcida em TARGET com escala e rampa explícitas; exige ALLOW_FANBASE_LOAD=true"
	@echo -e "  $(GREEN)test-504$(RESET)          - Diagnostica MODE=compare, session ou sync em TARGET; compare usa os três caminhos"
	@echo -e "  $(GREEN)test-run$(RESET)          - Executa SCENARIO no TARGET selecionado"
	@echo -e ""
	@echo -e "$(YELLOW)Observabilidade$(RESET)"
	@echo -e "  $(GREEN)obs-recon$(RESET)         - Descobre ALB, ASG e recursos atuais de HML"
	@echo -e "  $(GREEN)obs-collect$(RESET)       - Coleta métricas e logs AWS/SSM (RUN ou CW_MINUTES); informa disponibilidade de traces"
	@echo -e "  $(GREEN)obs-watch$(RESET)         - Acompanha ALB e hosts atuais do ASG (WATCH_INTERVAL em segundos)"
	@echo -e "  $(GREEN)obs-diagnose$(RESET)      - Correlaciona RUN com k6 e ALB; AZION_LOG recebe JSON ou CSV da equipe"
	@echo -e ""
	@echo -e "$(YELLOW)Docker$(RESET)"
	@echo -e "  $(GREEN)docker-build$(RESET)      - Constrói a imagem da suíte"
	@echo -e "  $(GREEN)docker-test$(RESET)       - Executa TEST=smoke, fanbase ou 504 no TARGET, com manifesto da rodada"
	@echo -e "  $(GREEN)docker-up$(RESET)         - Inicia em segundo plano o cenário definido em SCENARIO"
	@echo -e "  $(GREEN)docker-down$(RESET)       - Encerra o serviço e mantém os relatórios"
	@echo -e "  $(GREEN)docker-ps$(RESET)         - Exibe o estado dos contêineres"
	@echo -e "  $(GREEN)docker-logs$(RESET)       - Acompanha logs (LEVEL=all para todos, F=0 para consulta única)"
	@echo -e "  $(GREEN)docker-sh$(RESET)         - Abre um shell no contêiner da suíte"
	@echo -e "  $(GREEN)docker-clean$(RESET)      - Remove contêineres, redes e imagem local"
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
	@$(HML_RUNNER) --target "$(TARGET_ENV)" --target-url "$(TARGET_URL)" -- $(SMOKE_K6_ARGS)

hml-ec2-smoke:
	@$(HML_RUNNER) --target hml_ec2_direct --target-url "$(TARGET_URL)" -- $(SMOKE_K6_ARGS)

hml-azion-smoke:
	@$(HML_RUNNER) --target azion_edge -- $(SMOKE_K6_ARGS)

hml-multi-proxy-smoke:
	@$(HML_RUNNER) --target hml_alb -- $(SMOKE_K6_ARGS)

hml-ab-504:
	@status=0; \
	$(MAKE) hml-run SCENARIO=cache_bypass TARGET_ENV=hml_ec2_direct || status=$$?; \
	$(MAKE) hml-run SCENARIO=cache_bypass TARGET_ENV=azion_edge || status=$$?; \
	$(MAKE) hml-cw || status=$$?; exit $$status

hml-4way-504:
	@status=0; \
	for target in $(HML_COMPARE_TARGETS); do \
		$(MAKE) hml-run SCENARIO=heavy_sync_probe TARGET_ENV=$$target || status=$$?; \
	done; \
	$(MAKE) hml-cw || status=$$?; exit $$status

hml-session-lock:
	@$(HML_RUNNER) --scenario race_conditions --target "$(TARGET_ENV)" --target-url "$(TARGET_URL)" -- $(HML_TEST_ARGS)

hml-heavy-probe:
	@$(HML_RUNNER) --scenario heavy_sync_probe --target "$(TARGET_ENV)" --target-url "$(TARGET_URL)" -- $(HML_TEST_ARGS)

hml-azion-fanbase:
	$(foreach param,SCALE_FACTOR RAMP_UP HOLD RAMP_DOWN,$(if $(and $(filter command line environment,$(origin $(param))),$(strip $($(param)))),,$(error Informe $(param) explicitamente para hml-azion-fanbase)))
	$(if $(filter true,$(ALLOW_FANBASE_LOAD)),,$(error Use ALLOW_FANBASE_LOAD=true para hml-azion-fanbase))
	$(MAKE) hml-fanbase TARGET_ENV=azion_edge TARGET_URL=

hml-fanbase fanbase-hml:
	@if [ "$(ALLOW_FANBASE_LOAD)" != "true" ]; then echo "Informe ALLOW_FANBASE_LOAD=true para autorizar a carga."; exit 1; fi
	@$(HML_RUNNER) --scenario fanbase_simul --target "$(TARGET_ENV)" --target-url "$(TARGET_URL)" -- $(HML_TEST_ARGS)

hml-run:
	@$(HML_RUNNER) --scenario "$(SCENARIO)" --target "$(TARGET_ENV)" --target-url "$(TARGET_URL)" -- $(if $(filter smoke,$(SCENARIO)),$(SMOKE_K6_ARGS),$(HML_TEST_ARGS))

hml-diagnose:
	$(if $(strip $(RUN)),,$(error Informe RUN com o caminho do manifesto da rodada))
	@python3 scripts/operations/diagnose_hml.py --run "$(RUN)" --azion-log "$(AZION_LOG)"

hml-recon:
	bash scripts/recon-hml.sh

hml-cw:
	bash scripts/cloudwatch-summary.sh $(OBS_RUN_ARGS)

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
	@$(MAKE) docker-test TEST=smoke


docker-fanbase:
	@$(MAKE) docker-test TEST=fanbase


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


.PHONY: app-start app-gate app-hooks test-smoke test-fanbase test-504 test-run \
	obs-recon obs-collect obs-watch obs-diagnose docker-build docker-test

app-start: app-setup

app-hooks: app-pre-commit-run

app-gate:
	$(if $(filter $(STAGE),lint security test validate build all),,$(error STAGE inválido))
	$(PYTHON) $(ORCHESTRATOR) --stage $(if $(filter all,$(STAGE)),pipeline,$(STAGE))

test-smoke:
	$(if $(filter all,$(TARGET)),,$(if $(TEST_TARGET_ENV),,$(error TARGET deve ser azion, alb, ec2 ou all)))
	@status=0; \
	for target in $(if $(filter all,$(TARGET)),azion_edge hml_alb hml_ec2_direct,$(TEST_TARGET_ENV)); do \
		code=0; \
		$(HML_RUNNER) --target "$$target" --target-url "$(TARGET_URL)" -- $(SMOKE_K6_ARGS) || code=$$?; \
		if [ "$$code" -ne 0 ]; then \
			echo "Smoke falhou no alvo $$target (código $$code). Consulte os checks e o manifesto da rodada." >&2; \
			if [ "$$target" = "azion_edge" ]; then \
				echo "Dica: Para validar diretamente a infraestrutura AWS de HML sem passar pela borda da Azion, execute:" >&2; \
				echo "  make test-smoke TARGET=alb   (via Application Load Balancer teste-multi-proxy)" >&2; \
				echo "  make test-smoke TARGET=ec2   (via túnel SSM na EC2 do ASG)" >&2; \
			fi; \
			if [ "$$status" -eq 0 ]; then status=$$code; fi; \
		fi; \
	done; exit $$status

test-fanbase:
	$(if $(TEST_TARGET_ENV),,$(error TARGET deve ser azion, alb ou ec2))
	$(foreach param,SCALE_FACTOR RAMP_UP HOLD RAMP_DOWN,$(if $(and $(filter command line environment,$(origin $(param))),$(strip $($(param)))),,$(error Informe $(param) explicitamente)))
	@$(MAKE) hml-fanbase TARGET_ENV=$(TEST_TARGET_ENV)

test-run:
	$(if $(TEST_TARGET_ENV),,$(error TARGET deve ser azion, alb ou ec2))
	@$(MAKE) hml-run TARGET_ENV=$(TEST_TARGET_ENV)

test-504:
	$(if $(filter $(MODE),compare session sync),,$(error MODE deve ser compare, session ou sync))
	$(if $(filter compare,$(MODE)),,$(if $(TEST_TARGET_ENV),,$(error TARGET deve ser azion, alb ou ec2)))
	@status=0; \
	for target in $(if $(filter compare,$(MODE)),hml_ec2_direct hml_alb azion_edge,$(TEST_TARGET_ENV)); do \
		$(MAKE) hml-run TARGET_ENV=$$target SCENARIO=$(if $(filter compare,$(MODE)),cache_bypass,$(if $(filter session,$(MODE)),race_conditions,heavy_sync_probe)) || status=$$?; \
	done; exit $$status

obs-recon: hml-recon

obs-collect: hml-cw

obs-watch: hml-watch

obs-diagnose: hml-diagnose

docker-build:
	$(DOCKER_COMPOSE) build

docker-test:
	$(if $(TEST_TARGET_ENV),,$(error TARGET deve ser azion, alb ou ec2))
	$(if $(filter $(TEST),smoke fanbase 504),,$(error TEST deve ser smoke, fanbase ou 504))
	@test -f .env || cp .env.example .env
	@$(HML_RUNNER) --docker --scenario $(if $(filter fanbase,$(TEST)),fanbase_simul,$(if $(filter 504,$(TEST)),cache_bypass,smoke)) --target $(TEST_TARGET_ENV) -- $(if $(filter smoke,$(TEST)),$(SMOKE_K6_ARGS),$(HML_TEST_ARGS))
