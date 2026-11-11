# Estrutura do Repositório

Este documento descreve a topologia de diretórios, convenções de empacotamento e regras de isolamento arquitetural do **Palmeiras K6 Test (HML)**.

## 1. Topologia de Diretórios

```text
.
├── .agents/                               # Harness universal para LLMs e agentes autônomos
│   ├── README.md                          # Manifesto e governança do harness
│   ├── rules/                             # Regras de arquitetura, TDD, observabilidade e HML
│   └── skills/                            # Habilidades operacionais (quality-gate, run-hml-suite)
├── .githooks/                             # Hooks de fallback local
│   ├── commit-msg                         # Delega validacao para linters/git-hooks/commit-msg
│   └── pre-commit                         # Aciona pre-commit run ou clean_workspace.py --stage pipeline
├── .github/                               # Governança de CI/CD
│   ├── actions/
│   │   ├── ci/                            # Composite Actions (commitlint, typescript, docker, github, scripts, release)
│   │   └── shared/                        # README.md e pipeline-summary (GitHub Summary)
│   └── workflows/
│       ├── ci.yml                         # Pipeline CI/CD modular (NOME_DA_TECNOLOGIA | STEP) e semantic-release
│       └── templates/release-announcement.yaml
├── data/                                  # Datasets reais extraídos do ambiente HML
│   ├── fanbase-model.json                 # Modelo da torcida (14M - 17.5M) e limites da EC2 HML
│   └── hml-dataset.json                   # Posts, páginas, categorias, buscas e rotas REST HML
├── docs/                                  # Documentação viva do sistema
│   ├── README.md                          # Índice da documentação técnica
│   ├── arquitetura.md                     # Especificação DDD/Hexagonal e políticas HML
│   ├── structure.md                       # Estrutura do repositório (este documento)
│   ├── engineering-typescript.md          # Padrões TypeScript estrito, portas e testes
│   ├── engineering-logging.md             # Observabilidade semântica e catálogo de eventos
│   ├── infra-docker.md                    # Empacotamento Docker e execução conteinerizada
│   ├── devops.md                          # Matriz de qualidade unificada e pipeline CI
│   └── recon-hml.md                       # Inventário AWS HML e superfície da aplicação
├── infra/                                 # Documentação e composição de infraestrutura Docker
│   ├── README.md                          # Guia de contêiner e utilitários operacionais AWS
│   └── docker/
│       ├── .hadolint.yaml                 # Regras de lint de Dockerfile
│       ├── Dockerfile                     # Imagem grafana/k6 empacotada para execução em HML
│       └── docker-compose.yml             # Composição de execução para palmeiras-k6 em HML
├── linters/                               # Governança de análise estática e commits
│   ├── README.md                          # Padrões de TypeScript strict, ESLint e Conventional Commits
│   ├── commitlint.config.mjs              # Regras @commitlint/config-conventional
│   ├── releaserc.json                     # Configuração semantic-release
│   └── git-hooks/                         # install.sh, pre-commit, commit-msg, commitlint.sh e bin/
├── reports/                               # Relatórios HTML e JSON gerados pelo k6 (gitignored)
├── scripts/                               # Scripts operacionais e quality gate
│   ├── README.md                          # Documentação dos scripts
│   ├── operations/
│   │   ├── clean_workspace.py             # Orquestrador CI/CD por área e estágio (--stage pipeline)
│   │   └── gates/                         # Módulos por área (typescript, docker, github, scripts)
│   ├── recon-hml.sh                       # Levantamento read-only de recursos AWS HML
│   └── cloudwatch-summary.sh              # Correlação de métricas CloudWatch (EC2/ELB/RDS)
├── src/                                   # Código-fonte organizado em camadas DDD/Hexagonal
│   ├── README.md                          # Descrição das 4 camadas e tipos auxiliares
│   ├── domain/                            # Entidades, Value Objects, Políticas e Thresholds
│   ├── application/                       # Portas abstratas e Casos de Uso
│   ├── infrastructure/                    # Adaptadores k6, Settings, Logging e Relógio
│   ├── presentation/                      # Composition Root e os 9 cenários k6
│   └── types/                             # Declarações de ambiente k6 (k6.d.ts)
├── tests/                                 # Suíte automatizada com 100% branch coverage
│   ├── README.md                          # Estratégia e comandos da suíte de testes
│   ├── helpers/                           # Fakes e stubs em memória compartilhados nos testes
│   ├── unit/                              # Testes unitários isolados (domain e application)
│   └── integration/                       # Testes de integração de adaptadores e container
│       └── README.md                      # Documentação dos testes de integração
├── AGENTS.md                              # Diretrizes canônicas para agentes inteligentes
├── .dockerignore                          # Exclusões do contexto de build Docker
├── .pre-commit-config.yaml                # Hooks locais NOME_DA_TECNOLOGIA | STEP
├── Makefile                               # Interface unificada de automação de tarefas
├── README.md                              # Apresentação executiva do repositório
├── .env.example                           # Modelo de variáveis de runtime sem segredos reais
├── eslint.config.mjs                      # Configuração ESLint strict e fronteiras de importação
├── package.json                           # Dependências de desenvolvimento e scripts npm
├── tsconfig.build.json                    # Compilação de verificação de build para dist/
├── tsconfig.json                          # Configuração TypeScript estrita para análise e testes
└── vitest.config.ts                       # Configuração Vitest e exigência de 100% de cobertura
```

## 2. Invariantes de Dependência e Camadas

1. **Unidirecionalidade das Camadas**:
   - `src/domain/` não realiza imports de `k6`, `node:*`, `application`, `infrastructure` ou `presentation`.
   - `src/application/` importa exclusivamente módulos de `src/domain/` e de suas próprias interfaces em `src/application/ports/`.
   - Essas fronteiras são impostas automaticamente em tempo de lint via `no-restricted-imports` no arquivo [eslint.config.mjs](../eslint.config.mjs).
2. **Composition Root**:
   - O módulo [createRuntimeContainer.ts](../src/presentation/composition/createRuntimeContainer.ts) atua como o único Composition Root do sistema: instancia `Settings`, cria `TargetEnvironment` e `FanbaseAllocation`, injeta os adaptadores `k6` e retorna os casos de uso prontos para consumo pelos cenários em `src/presentation/scenarios/*.ts`.
3. **Resolução de Módulos (Imports TypeScript)**:
   - Todos os imports relativos em `src/` e `tests/` utilizam explicitamente a extensão `.ts` com `allowImportingTsExtensions: true` no `tsconfig.json` e `rewriteRelativeImportExtensions: true` no `tsconfig.build.json`.
   - Esse contrato assegura execução simultânea sem etapa prévia de transpilação tanto pelo motor TypeScript do `k6 v2.3.0` quanto pelo `Vitest` e compilação limpa via `tsc`.
