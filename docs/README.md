# Documentação Técnica

Índice da documentação viva e especificações técnicas de engenharia do projeto **Palmeiras K6 Test (HML)**.

## Documentos Disponíveis

- [arquitetura.md](arquitetura.md): Visão geral da arquitetura Hexagonal (Ports & Adapters), Domain-Driven Design (DDD), fluxo dos casos de uso e políticas de segurança HML.
- [structure.md](structure.md): Topologia completa do repositório de arquivos, invariantes de dependência e regras de resolução de módulos.
- [engineering-typescript.md](engineering-typescript.md): Diretrizes de codificação TypeScript estrito, zero comentários, mapeamento de portas/adaptadores e estratégia de 100% de cobertura.
- [engineering-logging.md](engineering-logging.md): Padrões de observabilidade semântica, catálogo canônico de eventos (`<contexto>.<entidade>.<acao>`), sanitização e correlação CloudWatch.
- [infra-docker.md](infra-docker.md): Especificações de empacotamento em contêiner `grafana/k6`, execução em HML e persistência de relatórios.
- [devops.md](devops.md): Matriz de qualidade unificada de 5 estágios, git hooks, governança de commits e pipeline CI no GitHub Actions.
- [recon-hml.md](recon-hml.md): Levantamento técnico da infraestrutura AWS HML, limites da instância EC2 `homolog`, Aurora MySQL e superfície REST real do WordPress.
