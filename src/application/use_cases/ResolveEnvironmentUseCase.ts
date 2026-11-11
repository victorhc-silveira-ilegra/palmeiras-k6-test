import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';

export class ResolveEnvironmentUseCase {
  public execute(targetEnvName: string): TargetEnvironment {
    return TargetEnvironment.fromName(targetEnvName);
  }
}
