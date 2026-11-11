# Recon de Infraestrutura AWS & Aplicação — Palmeiras HML

> **Política:** Levantamento realizado **exclusivamente** sobre o ambiente de Homologação (HML). Execução e testes direcionados a PROD são proibidos.

## 1. Inventário AWS HML (`Account: 000491796368` | `us-east-1`)

| Camada | Recurso | Identificador / Endpoint | Configuração Relevante para Testes |
| :--- | :--- | :--- | :--- |
| **VPC** | Palmeiras VPC | `vpc-afca57d5` (`172.31.0.0/16`) | VPC compartilhada; subnets públicas e privadas em `us-east-1a`, `us-east-1b`, `us-east-1d`. |
| **Edge / DNS** | Azion Edge | `hmlverdao.palmeiras.com.br` -> `e3z48rg94g.map.azionedge.net` | TLSv1.3 Let's Encrypt; conexões externas atuais encerradas na borda (`HTTP/2 PROTOCOL_ERROR`). |
| **DNS Legado** | CloudFront HML | `hmlsep.palmeiras.com.br` -> `d3jrob5cg4kg0b.cloudfront.net` | CNAME órfão (`NXDOMAIN`). |
| **ALB HML** | `Hml-Site-Azion` | `Hml-Site-Azion-206016081.us-east-1.elb.amazonaws.com` | `internet-facing`, HTTP/HTTPS -> TG `palmeiras-tg-hml` (porta `84`). SGs `alb-azion-only-1..5` liberam **apenas IPs Azion**. `idle_timeout=60s`, `stickiness=lb_cookie (3600s)`. Sem WAFv2. |
| **Classic ELB HML** | `dev-sep-hml` | `dev-sep-hml-160178191.us-east-1.elb.amazonaws.com` | **Acessível publicamente** (`sg-e99afeb0`, `0.0.0.0/0` em `80`/`443`). Encaminha para `i-02b29195a2fdaf1e7:84`. |
| **Compute (EC2)** | `homolog` (`Backup=HLG`) | `i-02b29195a2fdaf1e7` (`172.31.35.15`) | **Nó único (sem ASG)**, `t3a.medium` (2 vCPU, 3.86 GB RAM, 0 Swap), Ubuntu 24.04, `us-east-1b`, EBS `gp3` 100 GB (`3000 IOPS`, `125 MB/s`). |
| **Web / PHP** | Nginx + PHP 8.3 FPM | Portas `80`/`443` e `84` | Porta `84` (`classic_elb_healthcheck.conf`) **não** usa `fastcgi_cache`. `php8.3-fpm`: `pm=dynamic`, `pm.max_children=35`. |
| **Banco de Dados** | Aurora MySQL 8.0 | `db-sep-1.cluster-camzigu2hadx.us-east-1.rds.amazonaws.com` | `DB_NAME=sep_hml_db` via HyperDB. Instâncias `db-sep-escritor` + `db-sep-leitor` (`db.r6g.xlarge`, Multi-AZ). |
| **Storage / Cache** | S3 / EFS / Redis | `teste-com-redis-object-001/002`, `efs-palmeiras-wordpress` | Não montados/resolvidos na EC2 `homolog` (`df -hT` mostra apenas disco local `/dev/nvme0n1p1`). |
| **Observabilidade** | CloudWatch / Logs | Log group `/palmeiras/hml/nginx/error`, `CWAgent`, `newrelic-infra` | Alarme `PALMEIRAS-ACM-DAYS-TO-EXPIRY-HML-VERDAO-LOW` em **`ALARM`** (certificado ACM expira em `2026-11-25`). |

---

## 2. Descobertas Críticas da Aplicação & Riscos

1. **Redirect automático para PROD em páginas HTML (`log_homolog_v2`)**:
   - Em `/var/www/html/wordpress/wp-content/themes/foursys-palmeiras/functions.php` (linha `4920`), requisições **não autenticadas** para páginas HTML com `Host: hmlverdao.palmeiras.com.br` recebem `302 Found` para `https://www.palmeiras.com.br<uri>`.
   - **Ação na suíte k6**: `redirects: 0` obrigatório em `K6HttpTransportAdapter` + validação explícita (`ResponseSafetyPolicy`) proibindo `Location` apontando para `www.palmeiras.com.br` (`check: no_prod_redirect`).
   - **Impacto de cobertura**: testar `/`, `/noticias/...` ou `/?s=...` sem login apenas mede o redirect no `init` do WordPress. Para exercitar PHP, HyperDB e Aurora reais em HML sem login, o foco deve ser os endpoints `/wp-json/...` e `/wp-admin/admin-ajax.php`.
2. **Nginx porta 84 sem cache FastCGI**:
   - Ambos os LBs HML (`Hml-Site-Azion` e `dev-sep-hml`) entregam tráfego na porta `84` (`classic_elb_healthcheck.conf`), que não possui `fastcgi_cache` nem header `X-FastCGI-Cache`.
3. **Debug & Logging em disco habilitados em HML**:
   - `WP_DEBUG`, `WP_DEBUG_LOG` e `hyperdb-queries.log` estão ativos na EC2 `homolog`, rotacionando logs de ~5.2 MB a cada pico de requisições.
4. **Risco de Cluster RDS compartilhado (`db-sep-1`)**:
   - Embora `DB_NAME` seja isolado (`sep_hml_db`), o identificador do cluster Aurora (`db-sep-1`) é genérico. Confirmar com o time de infra se `db-sep-1` é exclusivo de HML antes de rodar `stress`/`spike` de alto volume em rotas sem cache.
5. **Superfície REST Real Mapeada em HML**:
   - `200 OK`: `/wp-json/wp/v2/posts`, `/wp-json/wp/v2/pages`, `/wp-json/wp/v2/search?search=...`, `/wp-json/apiverdao/v1/futebol/classificacao`, `/wp-json/apiverdao/v1/jogos-mes`, `/wp-json/apiverdao/v1/eventos-mes`, `/wp-json/apiverdao/v1/sep-lojas`, `/wp-json/apiverdao/v1/futebol/estatisticas`, `/wp-json/apiverdao/v1/buscar-noticias?q=...`, `/wp-json/palmeiras/v1/fotos`, `/wp-json/apiverdao/v1/videos-base`, `/wp-json/wp/v2/campeonato`.
   - `401 Unauthorized`: `/wp-json/toApp/v1/*` (APIs mobile autenticadas).
   - `500 Internal Server Error`: `/wp-json/palmeiras/v1/atendimento` e `/wp-json/apiverdao/v1/jogos-atualizar` (ausência de `FOOTSTATS_API` em HML).
   - Inexistentes neste stack: `/api/v1/ingressos/claim`, `grpc-hml.palmeiras.internal:50051`, `wss://ws-hml.palmeiras.internal/feed`.
