import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"

type Props = {
  tmpDir: string
  funnelDir: string
  port: number
}

/**
 * Gives each durable gateway endpoint its own replay database. Port zero is
 * ephemeral, so each construction receives a fresh scope instead of pretending
 * that replay can survive a restart onto a different assigned port.
 */
export function defaultEventDbPath(props: Props): string {
  const endpoint = props.port === 0 ? randomUUID() : String(props.port)
  const scope = createHash("sha256")
    .update(`${props.funnelDir}\0${endpoint}`)
    .digest("hex")
    .slice(0, 20)

  return join(props.tmpDir, "events", `${scope}.db`)
}
