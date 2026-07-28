import { join } from "node:path"

export type ConnectorDiagnosticLogPaths = {
  rawPath: string
  processedPath: string
  connectionPath: string
}

/** Default on-disk layout used by the bundled CLI and gateway daemon. */
export const connectorDiagnosticLogPaths = (tmpDir: string): ConnectorDiagnosticLogPaths => ({
  rawPath: join(tmpDir, "connector-raw.db"),
  processedPath: join(tmpDir, "connector-processed.db"),
  connectionPath: join(tmpDir, "connector-connection.db"),
})
