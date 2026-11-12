# Diretrizes de Git e Commits em Português do Brasil (PT-BR)

Todas as interações com o controle de versão neste repositório devem seguir rigorosamente o padrão **Conventional Commits** redigido exclusivamente em **Português do Brasil (PT-BR)**.

## 1. Padrão Obrigatório de Mensagem

```text
<tipo>(<escopo>): <descrição no presente ou infinitivo em português>
```

### Tipos Permitidos
- `feat`: Nova funcionalidade, novo cenário ou nova capacidade de teste/telemetria.
- `fix`: Correção de bug, threshold ou regra quebrada.
- `docs`: Documentação, planos, relatórios ou guias operacionais.
- `style`: Formatação, linting ou ajustes visuais sem alteração funcional.
- `refactor`: Refatoração estrutural mantendo o comportamento (ex: arquitetura hexagonal).
- `perf`: Otimizações de desempenho ou consumo de memória.
- `test`: Criação ou atualização de testes unitários ou de integração.
- `build`: Alterações no pipeline de compilação, TypeScript ou dependências.
- `ci`: Alterações no GitHub Actions, pre-commit ou orquestrador local.
- `chore`: Tarefas de manutenção ou automação de versão.

---

## 2. Regra Estrita de Idioma

> [!IMPORTANT]
> **PROIBIDO COMMITS EM INGLÊS**:
> Nenhuma mensagem de commit, pull request, branch ou título de relatório executivo pode ser escrita em língua inglesa. O vocabulário deve ser integralmente em português do Brasil.

### Exemplos Válidos (PT-BR)
- `feat(telemetria): adiciona observabilidade completa de HML com CloudWatch, RDS e SSM EC2`
- `feat(telemetria): adiciona modo live watch e sonda de acao pesada sincrona`
- `feat(relatorios): traduz nomes de cenarios checks e relatorios para pt-br`
- `feat(diagnostico): adapta suite hml para comparativo azion vs ec2 e trava fanbase`
- `fix(sessao): corrige deteccao de trava de sessao pos-504`
- `docs(regras): formaliza diretrizes de commits em pt-br para agentes`

### Exemplos Proibidos (Ingles) - Invalido
- `feat(telemetry): add live watch mode` (Incorreto - use `feat(telemetria): adiciona modo live watch`)
- `fix(session): fix session lock contention` (Incorreto - use `fix(sessao): corrige trava de sessao`)
- `feat(k6): update timeout to 310s` (Incorreto - use `feat(k6): atualiza timeout para 310s`)
