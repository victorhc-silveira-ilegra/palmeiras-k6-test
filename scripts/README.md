# Scripts Operacionais e de Automação (`scripts/`)

Este diretório reúne o orquestrador central da Matriz de Qualidade Unificada e os utilitários somente leitura para operação em HML na AWS.

## Estrutura

- `operations/clean_workspace.py`: Orquestrador modular Python 3.13 (`--area typescript|docker|github|scripts|all`, `--stage lint|security|test|validate|build|clean|pipeline|all`) acionado pelo `Makefile`, `.pre-commit-config.yaml` e `.github/workflows/ci.yml`.
- `operations/gates/`: Módulos especializados por tecnologia (`typescript_area.py`, `docker_area.py`, `github_area.py`, `scripts_area.py` e `common.py`).
- `recon-hml.sh`: Inventário somente leitura de recursos AWS HML via AWS CLI (EC2, ELB/ALB, Target Groups, Security Groups, RDS, ACM e CloudWatch Logs).
- `cloudwatch-summary.sh`: Coleta de telemetria pós-teste dos últimos minutos (CPU da EC2 `homolog`, tráfego do Classic ELB `dev-sep-hml`, cluster Aurora `db-sep-1` e erros Nginx).

Para detalhes da matriz de automação, consulte [docs/devops.md](../docs/devops.md) e [docs/recon-hml.md](../docs/recon-hml.md).
