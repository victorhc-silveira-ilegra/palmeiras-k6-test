# Regra de Arquitetura Hexagonal e DDD

1. O nucleo `src/domain/` nao pode importar nenhum modulo de `k6`, `node:*`, `application`, `infrastructure` ou `presentation`.
2. A camada `src/application/` depende exclusivamente de `src/domain/` e define as interfaces (Portas) em `src/application/ports/`.
3. A camada `src/infrastructure/` implementa as Portas para runtime `k6`, configuracao de ambiente e observabilidade semantica.
4. A camada `src/presentation/` atua exclusivamente como Composition Root (`src/presentation/composition/createRuntimeContainer.ts`) e entrypoints declarativos (`src/presentation/scenarios/*.ts`).
5. Todo arquivo em `src/` deve respeitar o limite maximo de 300 linhas, tipagem estrita TypeScript (`strict: true`) e ausencia absoluta de comentarios no codigo de aplicacao.
