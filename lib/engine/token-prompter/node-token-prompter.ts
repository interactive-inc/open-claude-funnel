import { stderr, stdin } from "node:process"
import { FunnelTokenPrompter } from "@/engine/token-prompter/token-prompter"

const STAR = "*"
const CR = "\r"
const LF = "\n"
const BACKSPACE = String.fromCharCode(0x08)
const DEL = String.fromCharCode(0x7f)
const CTRL_C = String.fromCharCode(0x03)
const CTRL_D = String.fromCharCode(0x04)

/**
 * Reads a secret from stdin in raw mode. Echoes a `*` per byte so the user
 * can see progress without exposing the token. Refuses to prompt when stdin
 * is not a TTY — callers should surface the resulting error with a hint
 * pointing at the corresponding env var or CLI command.
 */
export class NodeFunnelTokenPrompter extends FunnelTokenPrompter {
  async promptSecret(label: string): Promise<string> {
    if (!stdin.isTTY) {
      throw new Error(
        `cannot prompt for "${label}": stdin is not a TTY. Set the matching env var or run \`fnl channels <ch> connectors add ...\` first.`,
      )
    }

    stderr.write(`${label}: `)

    const wasRaw = stdin.isRaw

    stdin.setRawMode(true)
    stdin.resume()

    try {
      return await this.readSecret()
    } finally {
      stdin.setRawMode(wasRaw)
      stdin.pause()
      stderr.write(LF)
    }
  }

  private readSecret(): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = ""

      const onData = (chunk: Buffer): void => {
        for (const byte of chunk) {
          const char = String.fromCharCode(byte)

          if (char === LF || char === CR) {
            stdin.off("data", onData)
            resolve(buffer)
            return
          }

          if (char === CTRL_C) {
            stdin.off("data", onData)
            reject(new Error("prompt cancelled"))
            return
          }

          if (char === CTRL_D) {
            stdin.off("data", onData)

            if (buffer.length === 0) reject(new Error("prompt cancelled"))
            else resolve(buffer)
            return
          }

          if (char === BACKSPACE || char === DEL) {
            if (buffer.length > 0) {
              buffer = buffer.slice(0, -1)
              stderr.write("\b \b")
            }
            continue
          }

          buffer += char
          stderr.write(STAR)
        }
      }

      stdin.on("data", onData)
    })
  }
}
