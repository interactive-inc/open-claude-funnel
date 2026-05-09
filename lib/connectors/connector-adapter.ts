export type CallInput = {
  method: string
  path: string
  body?: unknown
}

export abstract class FunnelConnectorAdapter {
  abstract call(input: CallInput): Promise<unknown>
}
