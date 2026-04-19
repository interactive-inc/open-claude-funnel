import {
  FunnelHttpClient,
  type HttpRequest,
  type HttpResponse,
} from "@/modules/http/funnel-http-client"

export type MemoryHttpResponse = {
  status?: number
  body?: string
}

export type MemoryHttpHandler = (
  request: HttpRequest,
) => MemoryHttpResponse | Promise<MemoryHttpResponse>

export class MemoryFunnelHttpClient extends FunnelHttpClient {
  readonly calls: HttpRequest[] = []
  private handler: MemoryHttpHandler = () => ({ status: 200, body: "" })

  on(handler: MemoryHttpHandler): this {
    this.handler = handler

    return this
  }

  async fetch(request: HttpRequest): Promise<HttpResponse> {
    this.calls.push(request)

    const response = await this.handler(request)
    const status = response.status ?? 200
    const body = response.body ?? ""

    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => body,
      json: async () => JSON.parse(body),
    }
  }
}
