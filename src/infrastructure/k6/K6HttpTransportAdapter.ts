import {
  HttpTransportPort,
  TransportRequest,
  TransportResponse,
} from '../../application/ports/HttpTransportPort.ts';
import { K6Params, K6Response } from 'k6/http';

export interface K6HttpClientLike {
  get(url: string, params?: K6Params): K6Response;
  head(url: string, params?: K6Params): K6Response;
  options(url: string, body: string | null, params?: K6Params): K6Response;
  post(url: string, body: string | null, params?: K6Params): K6Response;
  expectedStatuses(...statuses: number[]): unknown;
}

export class K6HttpTransportAdapter implements HttpTransportPort {
  private readonly httpClient: K6HttpClientLike;
  private readonly commonHeaders: Record<string, string>;

  public constructor(httpClient: K6HttpClientLike, commonHeaders: Record<string, string> = {}) {
    this.httpClient = httpClient;
    this.commonHeaders = commonHeaders;
  }

  public request(req: TransportRequest): TransportResponse {
    const params: K6Params = {
      headers: { ...this.commonHeaders, ...req.headers },
      redirects: 0,
      tags: req.tags,
      timeout: req.timeout,
    };

    if (req.expectedStatuses && req.expectedStatuses.length > 0) {
      params.responseCallback = this.httpClient.expectedStatuses(...req.expectedStatuses);
    }

    const raw = this.dispatch(req, params);
    return {
      status: raw.status,
      body: typeof raw.body === 'string' ? raw.body : '',
      headers: raw.headers,
      durationMs: raw.timings.duration,
      error: raw.error,
      errorCode: raw.error_code,
      connectingMs: raw.timings.connecting,
      tlsHandshakingMs: raw.timings.tls_handshaking,
      waitingMs: raw.timings.waiting,
    };
  }

  private dispatch(req: TransportRequest, params: K6Params): K6Response {
    switch (req.method) {
      case 'HEAD':
        return this.httpClient.head(req.url, params);
      case 'OPTIONS':
        return this.httpClient.options(req.url, req.body ?? null, params);
      case 'POST':
        return this.httpClient.post(req.url, req.body ?? null, params);
      default:
        return this.httpClient.get(req.url, params);
    }
  }
}
