export type HttpRequest = {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
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
