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

## Reconhecimento de 13/11/2026

O ALB `teste-multi-proxy` foi localizado na conta de HML `000491796368`, em
`us-east-1`. Seu target group `palmeiras-hml-https` usa porta 443 e health check
HTTPS em `/check.html`. Os dois alvos do ASG `TESTE-WP` estavam saudáveis durante
a consulta. A conversa também menciona a conta `113984763320` para um chamado
distinto de health check, com HTTP na porta 80 em `/healthcheck.php`.

Use `make hml-cw-multi-proxy CW_MINUTES=15` para consultar volume, latência do
alvo, 504 emitidos pelo ALB e 5xx emitidos pelos alvos. O comando valida a
conta com STS e resolve a dimensão CloudWatch pelo ARN do ALB. A relação
entre a origem configurada na Azion e esse ALB precisa de confirmação pela
equipe com acesso à configuração da borda.

### Carga da torcida pela Azion

Use `make hml-azion-fanbase` para executar as seis personas pela URL do preset
`azion_edge`. A entrada exige `ALLOW_FANBASE_LOAD=true` e valores explícitos
para `SCALE_FACTOR`, `RAMP_UP`, `HOLD` e `RAMP_DOWN`. Combine os valores com
a equipe com base na capacidade observada de HML. Registre os parâmetros e o
pico de usuários virtuais que o k6 informa no início do cenário. `load` e
`stress` são sondas curtas. O POST real de atualização fica com a equipe.

Antes da rodada, confirme a origem da Azion no `teste-multi-proxy`, a montagem
do EFS no diretório servido pelas duas instâncias e as versões de WordPress e
PHP-FPM efetivamente em uso. O bootstrap v7 ainda referencia um EFS que não
foi encontrado na conta e região consultadas.

Anote o início e o fim com fuso e ajuste `CW_MINUTES` no comando
`make hml-cw-multi-proxy` para cobrir toda a janela a partir do início.
Correlacione o horário, a rota, a duração e o status do POST com os logs de
acesso do ALB. Quando disponíveis, use também o ID da requisição e os logs
da Azion para identificar a camada que emitiu um eventual 504.

### Smoke comparativo pela Azion e pelo ALB

Use `make hml-azion-smoke` para verificar a rota pela borda e
`make hml-multi-proxy-smoke` para executar o mesmo cenário diretamente no
`teste-multi-proxy`. O segundo comando confirma a conta AWS de HML e
resolve um IPv4 do ALB para aquela execução. O k6 mantém o hostname de
HML na URL, no SNI e na validação TLS. Os relatórios do acesso direto
usam o identificador `hml_multi_proxy`.

Ambos usam o perfil funcional por padrão, com dois usuários virtuais e
timeout de 15 segundos por requisição. O perfil strict preserva a rodada
curta de desempenho. Registre as janelas das duas execuções para
correlacionar com `make hml-cw-multi-proxy`.

## Ajustes operacionais de 19/11/2026

A execução na conta 000491796368, região us-east-1, confirmou o EFS
fs-043af440e6482fb9c (teste-hyperdb) montado via TLS no subdiretório
/hml-site-20261113 em /var/www/html/wordpress nas duas instâncias do TESTE-WP.
As referências antigas a fs-028da3dc70cc94323 foram removidas do fstab.
O Nginx passou a exigir a montagem antes de iniciar por um drop-in systemd.

O idle timeout do ALB teste-multi-proxy passou de 180 para 300 segundos.
O Nginx já tinha fastcgi_read_timeout de 300 segundos, e o PHP-FPM 8.3.36
ativo tinha request_terminate_timeout igual a zero. Esses limites foram
preservados. O WordPress em uso informa versão 7.1.4.

O tema já continha exceções para REST e AJAX na regra log_homolog_v2.
As verificações locais retornaram 200 para posts e busca, e 401 para
ToApp sem autenticação. A configuração usa o banco sep_hml_db.
Nenhuma configuração de banco ou arquivo da aplicação no EFS foi alterado.

Foi criada a AMI ami-0741dc0d88fc75eaa, sem reboot, e a versão 8 do
template HML-TESTE-ASG. O novo bootstrap valida a montagem existente
antes de iniciar o Nginx. A imagem contém os discos locais do host,
e os arquivos compartilhados seguem no EFS.

O primeiro smoke direto no ALB após os ajustes concluiu com 36 requisições
e zero falhas HTTP. O smoke pela Azion ficou sem iterações completas.
O certificado ACM do listener do ALB está válido até junho de 2027.
O certificado local do Nginx está expirado e precisa de tratamento
específico para acesso HTTPS direto ao host. O Nginx também emite aviso
de server_name duplicado na porta 80.

Rollback do provisionamento usa a AMI ami-0f847bc64b01f08dc e a versão 7
do template. A cópia anterior de fstab foi preservada em
/root/hml-rollback-20261119/fstab nos hosts de origem.
A atualização real do WordPress continua dependente de janela com o Palmeiras.

A primeira troca foi cancelada durante a validação inicial e repetida com
aquecimento de 300 segundos, mantendo as instâncias anteriores saudáveis.
Na segunda tentativa, as novas instâncias i-0f93311851a6f607f e
i-0004ae30b39b4593a concluíram cloud-init sem erros, montaram o EFS
automaticamente e responderam às sondagens locais com os códigos esperados.

O smoke direto adicional durante a troca teve 30 requisições, zero falhas
HTTP e check anti-redirecionamento aprovado. Reprovou no limite de
latência, com p95 de 3,12 segundos. O check de conteúdo do health check
também falhou por não encontrar a palavra healthy, apesar do HTTP 200.
Esses resultados exigem investigação de desempenho e alinhamento do
contrato de conteúdo do health check antes de declarar aprovação completa.

Com os alvos novos em serviço, uma repetição leve registrou 36 requisições,
zero falhas HTTP e p95 de 2,44 segundos, ainda acima do limite de 2 segundos.
O conteúdo do health check continuou divergente da expectativa healthy.
Nenhum ajuste de threshold foi feito para aprovar essas medições.

A atualização 3428bcc1-9fcf-4e30-a0d1-36a2d8e3fef9 terminou Successful,
100 por cento. O ASG ficou fixado na versão 8, com dois alvos saudáveis:
i-0004ae30b39b4593a e i-0f93311851a6f607f. A versão 7 permanece
disponível para rollback. O CloudWatch consultado durante a execução
não publicou pontos de 504 do ALB nem de 5xx dos alvos na janela coletada.

## Perfis de smoke para a topologia atual

O perfil padrão é funcional. Ele executa uma iteração em cada um dos dois
usuários virtuais, com limite total de 100 segundos e timeout de 15 segundos
por requisição. A aprovação exige duas iterações completas, zero falhas HTTP
e todos os checks aprovados. O health check exige HTTP 200, conforme o
target group. As rotas REST mantêm os checks de conteúdo e autenticação.

O perfil strict usa dois usuários por 20 segundos, com 5 segundos para
parada graciosa e timeout de 3 segundos por requisição. Ele mantém os
limites de latência originais. REQUEST_TIMEOUT substitui o timeout de
qualquer perfil quando informado explicitamente.

Comandos para execução leve autorizada:

```bash
make hml-azion-smoke
make hml-multi-proxy-smoke
make hml-azion-smoke SMOKE_PROFILE=strict
make hml-multi-proxy-smoke SMOKE_PROFILE=strict REQUEST_TIMEOUT=5s
```

O comando `make hml-ec2-smoke` seleciona automaticamente uma instância
saudável do ASG TESTE-WP que esteja online no SSM, abre uma porta local
temporária para o Nginx de validação em 8083 e encerra o túnel ao terminar.
Ele confirma a conta e o vínculo do ASG com o target group de HML.
Requer AWS CLI, Session Manager Plugin e permissões SSM de sessão.
TARGET_URL continua disponível como override para um túnel já existente.

Para a EC2 legada, abra um túnel SSM em um terminal e informe o destino
local no segundo.

```bash
aws ssm start-session --region us-east-1 --target i-02b29195a2fdaf1e7 \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["84"],"localPortNumber":["8084"]}'
make hml-ec2-smoke TARGET_URL=http://127.0.0.1:8084
```

Os resumos do terminal, HTML e JSON registram o perfil, o caminho, o timeout
e a janela UTC. Status zero é registrado como falha de transporte com os
detalhes do runtime. A métrica upstream_ttfb_ms usa o tempo de espera
quando fornecido pelo transporte. Os logs continuam passando por sanitização.

## Operação alinhada à topologia atual

A configuração operacional fica em data/hml-topology.json. O padrão
HML_TOPOLOGY=current descobre teste-multi-proxy, palmeiras-hml-https e os
membros do TESTE-WP. A descoberta valida conta, região, vínculo com o ASG
e VPC. HML_TOPOLOGY=legacy seleciona explicitamente a topologia anterior.
Os comandos antigos continuam como aliases de compatibilidade.

A interface principal do Makefile tem quatro categorias.

| Categoria | Entradas |
| --- | --- |
| APP | app-setup, app-ci, app-gate, app-hooks, app-clean |
| Testes | test-smoke, test-fanbase, test-504, test-run |
| Observabilidade | obs-recon, obs-collect, obs-watch, obs-diagnose |
| Docker | docker-build, docker-test, docker-up, docker-down, docker-ps, docker-logs, docker-sh, docker-clean |

Exemplos para rodadas autorizadas:

```bash
make test-smoke TARGET=azion
make test-smoke TARGET=alb
make test-smoke TARGET=ec2
make test-smoke TARGET=all
make test-smoke TARGET=alb SMOKE_PROFILE=strict
make test-504 MODE=compare
make test-504 MODE=session TARGET=azion
make test-504 MODE=sync TARGET=alb HEAVY_PATH=/wp-admin/
```

MODE=compare verifica os caminhos EC2, ALB e Azion com cache_bypass.
MODE=session executa o diagnóstico de sessão. MODE=sync permite uma ação
administrativa configurável e deve ser usado somente em uma rodada
autorizada para essa ação. A atualização real do WordPress deve ser
combinada com a equipe. Esses exemplos não são executados pelo quality gate.

O fanbase continua exigindo autorização e escala explícitas:

```bash
make test-fanbase TARGET=azion ALLOW_FANBASE_LOAD=true SCALE_FACTOR=0.4 RAMP_UP=5s HOLD=15s RAMP_DOWN=5s
```

Cada execução pelo controlador gera um UUID e um manifesto em
reports/runs/<UUID>.json. O manifesto registra recursos resolvidos,
perfil, timeout, código de saída e janela UTC/BRT, sem cookies ou credenciais.
O UUID é propagado às tags, aos logs semânticos, aos relatórios e ao
cabeçalho X-HML-Test-Run-Id. O ALB não registra esse cabeçalho arbitrário,
portanto a correlação com o ALB é apresentada como candidatos por janela,
método e rota. Não há atribuição automática de causalidade.

```bash
make obs-recon
make obs-collect CW_MINUTES=15
make obs-watch WATCH_INTERVAL=15
make obs-collect RUN=reports/runs/<UUID>.json
make obs-diagnose RUN=reports/runs/<UUID>.json AZION_LOG=/caminho/azion.json
```

A coleta classifica fontes como ok, no_data, unavailable ou error.
Uma série sem pontos não é substituída por zero. O watch redescobre os
hosts a cada ciclo e aplica o intervalo após terminar a coleta.
A coleta SSM executa somente inspeções de leitura nos membros descobertos.

As métricas de banco de db-sep são contexto do cluster compartilhado.
Os logs do banco são contabilizados sem expor SQL e sem atribuir eventos
à rodada. Os logs Nginx do CloudWatch são filtrados pelos IDs das instâncias.
Os logs internos são limitados às últimas 64 KiB e às linhas cujo timestamp
seja reconhecido na janela; a cobertura parcial é registrada. O diagnóstico
histórico usa os IDs do manifesto quando o vínculo com o ASG pode ser
verificado e sinaliza os membros históricos indisponíveis.

Os logs do ALB são paginados no S3 e lidos nas entregas candidatas até
30 minutos após a janela. A ausência de arquivos é delivery_pending.
Mesmo com arquivos, o serviço tem entrega best effort.

O arquivo da Azion deve ser uma lista JSON, um objeto com records ou CSV.
Os campos normalizados são timestamp com fuso, method, path ou url,
origin, status, connection_result e request_id. Consultas nas URLs são
removidas. O relatório mantém association=pending mesmo ao encontrar um
candidato temporal no ALB; o identificador da borda deve confirmar a relação.

Traces aparecem como unavailable enquanto uma fonte APM não for confirmada.
A suíte não instala instrumentação nem presume acesso ao painel da Azion.

### Docker

docker-test usa o mesmo controlador nativo, com descoberta e manifesto.
O container recebe os parâmetros resolvidos, e as credenciais AWS ficam no
controlador da máquina. O Compose usa rede do host para alcançar o túnel
SSM em loopback, compatível com a execução Linux deste projeto.

```bash
make docker-build
make docker-test TEST=smoke TARGET=alb
make docker-test TEST=smoke TARGET=ec2
make docker-test TEST=504 TARGET=azion
```

docker-up é uma operação avulsa de ciclo de vida que inicia SCENARIO em
segundo plano. Para rodadas com manifesto e diagnóstico, use docker-test.
