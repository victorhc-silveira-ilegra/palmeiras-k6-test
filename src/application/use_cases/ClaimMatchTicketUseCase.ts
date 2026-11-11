import { TargetEnvironment } from '../../domain/value_objects/TargetEnvironment.ts';
import { ClockPort } from '../ports/ClockPort.ts';
import { TransportResponse } from '../ports/HttpTransportPort.ts';
import { MetricsRecorderPort } from '../ports/MetricsRecorderPort.ts';
import { HttpRouteClient } from './HttpRouteClient.ts';

export class ClaimMatchTicketUseCase {
  private readonly env: TargetEnvironment;
  private readonly client: HttpRouteClient;
  private readonly clock: ClockPort;
  private readonly metrics: MetricsRecorderPort;

  public constructor(
    env: TargetEnvironment,
    client: HttpRouteClient,
    clock: ClockPort,
    metrics: MetricsRecorderPort
  ) {
    this.env = env;
    this.client = client;
    this.clock = clock;
    this.metrics = metrics;
  }

  public execute(userId: string, matchId: string, seatId: string): TransportResponse {
    const payload = JSON.stringify({
      user_id: userId,
      match_id: matchId,
      seat_id: seatId,
      timestamp: this.clock.nowMs(),
      env: this.env.name,
    });

    const res = this.client.execute({
      method: 'POST',
      path: '/api/v1/ingressos/claim',
      body: payload,
      extraHeaders: { 'Content-Type': 'application/json' },
      tags: { type: 'transactional', route: 'claim_ticket' },
      routeName: 'claim_ticket',
      expectedStatuses: [200, 302, 404, 409, 422],
      allowKnownHomologRedirect: true,
    });

    this.metrics.recordChecks(res, {
      race_condition_handled: () => [200, 302, 404, 409, 422].includes(res.status),
      'no unhandled 500 error': () => res.status !== 500,
    });

    return res;
  }
}
