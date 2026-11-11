export interface SummaryRenderers {
  htmlReport(data: unknown): string;
  textSummary(data: unknown, options: { indent: string; enableColors: boolean }): string;
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
    return {
      [`${prefix}.html`]: renderers.htmlReport(data),
      [`${prefix}.json`]: JSON.stringify(data),
      stdout: renderers.textSummary(data, { indent: ' ', enableColors: true }),
    };
  };
}
