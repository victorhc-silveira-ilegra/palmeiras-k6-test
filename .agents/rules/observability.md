# Regra de Observabilidade Semantica

1. Eventos estruturados devem ser emitidos exclusivamente por adaptadores que implementem `EventLoggerPort` utilizando `logEvent(sink, level, event, fields)` no formato `<contexto>.<entidade>.<acao>`.
2. Camadas `src/domain/` e `src/application/` nao chamam `console` diretamente nem formatam saida de log.
3. O nivel `INFO` registra somente marcos relevantes de ciclo (inicio do cenario em `setup()`).
4. Todos os campos registrados passam obrigatoriamente por `sanitizeLogFields`, redigindo chaves de credenciais (`authorization`, `cookie`, `token`, `secret`), tokens inline (`Bearer`), query params sensiveis e truncando payloads acima de 256 caracteres.
