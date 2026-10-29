export type HttpRequest = {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  /** Cancel the request and response-body reads when its owning operation stops. */
  signal?: AbortSignal
}

export type HttpResponse = {
  status: number
  ok: boolean
  text(): Promise<string>
  json(): Promise<unknown>
}

export abstract class FunnelHttpClient {
  abstract fetch(request: HttpRequest): Promise<HttpResponse>
}
