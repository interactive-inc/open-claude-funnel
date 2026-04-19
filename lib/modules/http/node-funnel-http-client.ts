import {
  FunnelHttpClient,
  type HttpRequest,
  type HttpResponse,
} from "@/modules/http/funnel-http-client"

export class NodeFunnelHttpClient extends FunnelHttpClient {
  constructor() {
    super()
    Object.freeze(this)
  }

  async fetch(request: HttpRequest): Promise<HttpResponse> {
    const res = await globalThis.fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    })

    return {
      status: res.status,
      ok: res.ok,
      text: () => res.text(),
      json: () => res.json(),
    }
  }
}
