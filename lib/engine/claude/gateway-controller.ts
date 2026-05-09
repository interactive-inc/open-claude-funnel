export type GatewayController = {
  isRunning(): boolean
  start(options?: { caffeinate?: boolean }): Promise<boolean>
}
