# Regra de TDD e Cobertura de 100 Por Cento

1. Novas regras de dominio ou casos de uso devem iniciar pelos testes automatizados em `tests/unit/` antes da implementacao.
2. Adaptadores em `src/infrastructure/` e o Composition Root devem ser cobertos por testes de integracao em `tests/integration/`.
3. A meta minima e inegociavel e de 100 por cento em linhas, funcoes, declaracoes e desvios (`branch coverage`) medida via `vitest run --coverage`.
4. Toda alteracao nos cenarios em `src/presentation/scenarios/*.ts` deve passar em `k6 inspect` antes de qualquer execucao em HML.
