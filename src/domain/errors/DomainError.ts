export class DomainInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DomainInvariantError';
  }
}

export class ForbiddenProductionTargetError extends DomainInvariantError {
  public constructor(context: string, value: string) {
    super(
      `ABORTADO [ANTI-PROD]: Alvo proibido detectado em ${context}: "${value}". Apenas HML é permitido.`
    );
    this.name = 'ForbiddenProductionTargetError';
  }
}
