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
      claude: "lib/claude.ts",
      gateway: "lib/gateway.ts",
      profiles: "lib/profiles.ts",
      "local-config": "lib/local-config.ts",
      diagnostics: "lib/diagnostics.ts",
      recovery: "lib/recovery.ts",
      doctor: "lib/doctor.ts",
      docs: "lib/docs.ts",
      "connectors/slack": "lib/engine/connectors/slack.ts",
      "connectors/discord": "lib/engine/connectors/discord.ts",
      "connectors/gh": "lib/engine/connectors/gh.ts",
      "connectors/schedule": "lib/engine/connectors/schedule.ts",
      logger: "lib/logger.ts",
      channel: "lib/channel.ts",
    },
    format: "esm",
    dts: true,
    deps: { neverBundle: ["bun", "bun:sqlite"] },
    outExtensions: () => ({ js: ".js" }),
  },
})
