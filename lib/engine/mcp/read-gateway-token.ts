import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const readGatewayToken = (dir: string): string | null => {
  const fromEnv = process.env.FUNNEL_GATEWAY_TOKEN

  if (fromEnv && fromEnv.length > 0) return fromEnv

  const path = join(dir, "gateway.token")

  if (!existsSync(path)) return null

  const value = readFileSync(path, "utf-8").trim()

  return value.length > 0 ? value : null
}
