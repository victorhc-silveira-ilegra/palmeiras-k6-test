import { EnvironmentName } from '../entities/JourneyModels.ts';
import { DomainInvariantError, ForbiddenProductionTargetError } from '../errors/DomainError.ts';

export interface TargetEnvironmentProps {
  name: EnvironmentName;
  baseUrl: string;
  hostHeader: string;
  insecureSkipTLSVerify: boolean;
  timeout: string;
}

const FORBIDDEN_PROD_PATTERNS: readonly RegExp[] = [
  /prod/i,
  /www\.palmeiras\.com\.br/i,
  /1627138501/,
];

const ENVIRONMENT_PRESETS: Record<EnvironmentName, TargetEnvironmentProps> = {
  hml_classic_elb: {
    name: 'hml_classic_elb',
    baseUrl: 'https://dev-sep-hml-160178191.us-east-1.elb.amazonaws.com',
    hostHeader: 'hmlverdao.palmeiras.com.br',
    insecureSkipTLSVerify: true,
    timeout: '310s',
  },
  hml_alb: {
    name: 'hml_alb',
    baseUrl: 'http://Hml-Site-Azion-206016081.us-east-1.elb.amazonaws.com',
    hostHeader: 'hmlverdao.palmeiras.com.br',
    insecureSkipTLSVerify: false,
    timeout: '310s',
  },
  azion_edge: {
    name: 'azion_edge',
    baseUrl: 'https://hmlverdao.palmeiras.com.br',
    hostHeader: 'hmlverdao.palmeiras.com.br',
    insecureSkipTLSVerify: false,
    timeout: '310s',
  },
  hml_ec2_direct: {
    name: 'hml_ec2_direct',
    baseUrl: 'http://52.202.111.170:80',
    hostHeader: 'hmlverdao.palmeiras.com.br',
    insecureSkipTLSVerify: true,
    timeout: '310s',
  },
  ec2_direct: {
    name: 'ec2_direct',
    baseUrl: 'http://52.202.111.170:80',
    hostHeader: 'hmlverdao.palmeiras.com.br',
    insecureSkipTLSVerify: true,
    timeout: '310s',
  },
};

export function assertNotProd(value: unknown, context = 'target'): void {
  const text = String(value ?? '');
  if (FORBIDDEN_PROD_PATTERNS.some((pattern) => pattern.test(text))) {
    throw new ForbiddenProductionTargetError(context, text);
  }
}

export class TargetEnvironment {
  public readonly name: EnvironmentName;
  public readonly baseUrl: string;
  public readonly hostHeader: string;
  public readonly insecureSkipTLSVerify: boolean;
  public readonly timeout: string;

  private constructor(props: TargetEnvironmentProps) {
    this.name = props.name;
    this.baseUrl = props.baseUrl;
    this.hostHeader = props.hostHeader;
    this.insecureSkipTLSVerify = props.insecureSkipTLSVerify;
    this.timeout = props.timeout;
  }

  public static create(props: TargetEnvironmentProps): TargetEnvironment {
    assertNotProd(props.name, 'TargetEnvironment.name');
    assertNotProd(`${props.baseUrl} ${props.hostHeader}`, `ENVIRONMENTS.${props.name}`);
    if (!props.baseUrl.trim()) {
      throw new DomainInvariantError('baseUrl nao pode ser vazia.');
    }
    if (!props.hostHeader.trim()) {
      throw new DomainInvariantError('hostHeader nao pode ser vazio.');
    }
    return new TargetEnvironment(props);
  }

  public static fromName(
    targetName: string,
    targetUrlOverride?: string,
    timeoutOverride?: string
  ): TargetEnvironment {
    assertNotProd(targetName, 'TARGET_ENV');
    if (!Object.prototype.hasOwnProperty.call(ENVIRONMENT_PRESETS, targetName)) {
      const allowed = Object.keys(ENVIRONMENT_PRESETS).join(', ');
      throw new DomainInvariantError(
        `TARGET_ENV inválido "${targetName}". Permitidos apenas: ${allowed}`
      );
    }
    const preset = ENVIRONMENT_PRESETS[targetName as EnvironmentName];
    const resolvedUrl = targetUrlOverride?.trim() ? targetUrlOverride.trim() : preset.baseUrl;
    if (targetUrlOverride?.trim()) {
      assertNotProd(resolvedUrl, 'TARGET_URL');
      if (!/^https?:\/\//i.test(resolvedUrl)) {
        throw new DomainInvariantError(`TARGET_URL inválida "${resolvedUrl}". Use http:// ou https://.`);
      }
    }
    const resolvedTimeout = timeoutOverride?.trim() ? timeoutOverride.trim() : preset.timeout;
    return TargetEnvironment.create({
      ...preset,
      baseUrl: resolvedUrl.replace(/\/+$/, ''),
      timeout: resolvedTimeout,
    });
  }
}
