export interface SummaryRenderers {
  htmlReport(data: unknown, options?: { title?: string }): string;
  textSummary(data: unknown, options: { indent: string; enableColors: boolean }): string;
}

const SCENARIO_DISPLAY_TITLES: Record<string, string> = {
  smoke: 'Validação Rápida de Saúde e Conectividade (Smoke)',
  load: 'Sonda de Limites de Timeout (310s) e TTFB',
  cache_bypass: 'Teste Sem Cache (Bypass Azion → Origem)',
  api_mix: 'Varredura Sequencial das APIs Palmeiras e WordPress',
  race_conditions: 'Diagnóstico de Trava de Sessão Pós-504 (/wp-admin)',
  stress: 'Diagnóstico de Handshake e Keep-Alive na Borda',
  spike: 'Rajada Curta de Reconexão e Lock (2 VUs)',
  soak: 'Monitoramento Contínuo de Estabilidade de Sessão',
  fanbase_simul: 'Simulação Calibrada da Torcida (Fanbase)',
};

export function resolveExecutiveReportTitle(scenarioName: string, envName: string): string {
  const friendly = SCENARIO_DISPLAY_TITLES[scenarioName] ?? scenarioName;
  return `Palmeiras HML — ${friendly} [${envName}]`;
}

export function createSummaryHandler(
  scenarioName: string,
  envName: string,
  renderers: SummaryRenderers,
  nowFactory: () => Date = (): Date => new Date()
): (data: unknown) => Record<string, string> {
  return (data: unknown): Record<string, string> => {
    const timestamp = nowFactory().toISOString().replace(/[:.]/g, '-');
    const prefix = `reports/summary-${envName}-${scenarioName}-${timestamp}`;
    const title = resolveExecutiveReportTitle(scenarioName, envName);
    return {
      [`${prefix}.html`]: renderers.htmlReport(data, { title }),
      [`${prefix}.json`]: JSON.stringify(data),
      stdout: renderers.textSummary(data, { indent: ' ', enableColors: true }),
    };
  };
}
