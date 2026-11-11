import { HeaderMap, HttpMethod } from '../../domain/entities/JourneyModels.ts';

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
  timeout: string;
  tags: Record<string, string>;
  expectedStatuses?: number[];
}

export interface TransportResponse {
  status: number;
  body: string;
  headers: HeaderMap;
  durationMs: number;
}

export interface HttpTransportPort {
  request(req: TransportRequest): TransportResponse;
}
