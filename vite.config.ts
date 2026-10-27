import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./lib", import.meta.url)) } },
  ssr: { external: ["bun", "bun:sqlite"] },
  fmt: { semi: false },
  lint: {
    ignorePatterns: ["node_modules/**"],
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
  },
  pack: {
    entry: {
      index: "lib/index.ts",
      gateway: "lib/gateway.ts",
      channel: "lib/channel.ts",
      "event-log": "lib/event-log.ts",
      logger: "lib/logger.ts",
      sqlite: "lib/sqlite.ts",
      "connectors/slack": "lib/engine/connectors/slack.ts",
      "connectors/discord": "lib/engine/connectors/discord.ts",
      "connectors/gh": "lib/engine/connectors/gh.ts",
      "connectors/schedule": "lib/engine/connectors/schedule.ts",
    },
    format: "esm",
    dts: { generator: "tsgo" },
    deps: { neverBundle: ["bun", "bun:sqlite"] },
    outExtensions: () => ({ js: ".js" }),
  },
})
