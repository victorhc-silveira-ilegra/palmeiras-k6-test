# Regra Invariante de Seguranca Anti-PROD (Somente HML)

1. E terminantemente proibido direcionar qualquer execucao ou script para o ambiente de producao (`www.palmeiras.com.br`, `Prod-Site-Azion`, `prod_alb`, `1627138501`).
2. O Value Object `TargetEnvironment` deve abortar imediatamente (`ForbiddenProductionTargetError`) caso `TARGET_ENV`, `baseUrl` ou `hostHeader` contenham qualquer padrao proibido de producao.
3. Todas as chamadas HTTP em `K6HttpTransportAdapter` devem aplicar `redirects: 0` para impedir redirecionamento automatico `302` do `log_homolog_v2()` em HTML para `www.palmeiras.com.br`.
4. O threshold `checks{check:no_prod_redirect}: ['rate==1']` e obrigatorio em todos os cenarios da suíte.
