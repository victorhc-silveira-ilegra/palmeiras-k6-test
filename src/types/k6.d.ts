declare module 'k6' {
  export type Checkers<T> = Record<string, (val: T) => boolean>;
  export function check<T>(val: T, sets: Checkers<T>): boolean;
  export function sleep(t: number): void;
}

declare module 'k6/http' {
  export interface K6Response {
    status: number;
    body: string | ArrayBuffer | null;
    headers: Record<string, string>;
    timings: { duration: number };
  }
  export interface K6Params {
    headers?: Record<string, string>;
    redirects?: number;
    tags?: Record<string, string>;
    timeout?: string;
    responseCallback?: unknown;
  }
  const http: {
    get(url: string, params?: K6Params): K6Response;
    head(url: string, params?: K6Params): K6Response;
    options(url: string, body: string | null, params?: K6Params): K6Response;
    post(url: string, body: string | null, params?: K6Params): K6Response;
    expectedStatuses(...statuses: number[]): unknown;
  };
  export default http;
}

declare module 'k6/metrics' {
  export class Counter {
    constructor(name: string);
    add(value: number): void;
  }
  export class Rate {
    constructor(name: string);
    add(value: number | boolean): void;
  }
  export class Trend {
    constructor(name: string, isTime?: boolean);
    add(value: number): void;
  }
}

declare module 'k6/data' {
  export class SharedArray<T> extends Array<T> {
    constructor(name: string, fn: () => T[]);
  }
}

declare module 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js' {
  export function htmlReport(data: unknown): string;
}

declare module 'https://jslib.k6.io/k6-summary/0.0.1/index.js' {
  export function textSummary(
    data: unknown,
    options?: { indent?: string; enableColors?: boolean }
  ): string;
}

declare const __ENV: Record<string, string | undefined>;
declare const __VU: number;
declare const __ITER: number;
declare function open(path: string): string;
