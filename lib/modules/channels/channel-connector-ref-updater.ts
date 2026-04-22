export type ChannelConnectorRefUpdater = {
  renameRef(oldName: string, newName: string): void
  removeRef(connectorName: string): void
}
