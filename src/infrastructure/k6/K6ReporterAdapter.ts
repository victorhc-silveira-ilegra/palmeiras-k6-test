export interface SummaryRenderers {
  htmlReport(data: unknown, options?: { title?: string }): string;
  textSummary(data: unknown, options: { indent: string; enableColors: boolean }): string;
}

const SCENARIO_DETAILS: Record<string, { title: string; description: string }> = {
  smoke: {
    title: 'Verificação rápida do WordPress',
    description: 'Verifica o health check, a página inicial, as rotas REST e a exigência de autenticação no ToApp.',
  },
  load: {
    title: 'Sonda de tempo de resposta do WordPress',
    description: 'Consulta saúde e buscas e verifica o caminho administrativo e AJAX em três iterações.',
  },
  cache_bypass: {
    title: 'Diagnóstico de requisições sem cache',
    description: 'Consulta posts, buscas e AJAX para observar latência e falhas com requisições que evitam cache nas rotas compatíveis.',
  },
  api_mix: {
    title: 'Verificação das APIs Palmeiras e WordPress',
    description: 'Consulta notícias, jogos, eventos, estatísticas, lojas e mídia e verifica a autenticação no ToApp.',
  },
  race_conditions: {
    title: 'Diagnóstico de bloqueio de sessão após timeout',
    description: 'Compara a resposta após uma chamada AJAX usando a mesma sessão e um controle sem cookie.',
  },
  stress: {
    title: 'Sonda curta de saúde, REST e AJAX',
    description: 'Repete verificações de saúde, busca REST e AJAX com dois usuários virtuais por 20 segundos.',
  },
  spike: {
    title: 'Rajada curta de busca e sessão',
    description: 'Executa buscas REST e verifica contenção de sessão com dois usuários virtuais em duas iterações por usuário.',
  },
  soak: {
    title: 'Acompanhamento de estabilidade do WordPress',
    description: 'Repete verificações de saúde, posts REST e AJAX durante o intervalo configurado.',
  },
  fanbase_simul: {
    title: 'Simulação de tráfego da torcida',
    description: 'Executa seis perfis de navegação em paralelo, com escala e rampa configuráveis.',
  },
  heavy_sync_probe: {
    title: 'Diagnóstico de operação síncrona do WordPress',
    description: 'Mede uma ação administrativa configurável e acompanha uma chamada concorrente da sessão.',
  },
};

export function resolveExecutiveReportTitle(scenarioName: string, envName: string): string {
  const friendly = SCENARIO_DETAILS[scenarioName]?.title ?? scenarioName;
  return `Palmeiras HML — ${friendly} [${envName}]`;
}

export function createSummaryHandler(
  scenarioName: string,
  envName: string,
  renderers: SummaryRenderers,
  nowFactory: () => Date = (): Date => new Date(),
  metadata: Record<string, string> = {}
): (data: unknown) => Record<string, string> {
  return (data: unknown): Record<string, string> => {
    const finishedAtUtc = nowFactory().toISOString();
    const timestamp = finishedAtUtc.replace(/[:.]/g, '-');
    const prefix = `reports/summary-${envName}-${scenarioName}-${timestamp}`;
    const title = resolveExecutiveReportTitle(scenarioName, envName);
    const description = SCENARIO_DETAILS[scenarioName]?.description ??
      'Consulte as métricas e verificações para avaliar a execução.';
    const durationMs = (data as { state?: { testRunDurationMs?: number } }).state?.testRunDurationMs;
    const timedMetadata = typeof durationMs === 'number'
      ? { ...metadata, startedAtUtc: new Date(Date.parse(finishedAtUtc) - durationMs).toISOString() }
      : metadata;
    const scenario = { id: scenarioName, environment: envName, title, description, ...timedMetadata, finishedAtUtc };
    const details = Object.entries({ ...timedMetadata, finishedAtUtc })
      .map(([key, value]) => `${key} = ${value}`).join('\n');
    const escapedDetails = details.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
    const html = renderers.htmlReport(data, { title }).replace(
      /<body\b[^>]*>/i,
      (body) => `${body}<p style="margin: 1rem 2rem"><strong>Objetivo:</strong> ${description}</p><pre style="margin: 1rem 2rem">${escapedDetails}</pre>`
    );
    const summary = renderers.textSummary(data, { indent: ' ', enableColors: true });
    return {
      [`${prefix}.html`]: html,
      [`${prefix}.json`]: JSON.stringify({ ...(data as Record<string, unknown>), scenario }),
      stdout: `\n${title}\nObjetivo: ${description}\n${details}\n\n${summary}`,
    };
  };
}
