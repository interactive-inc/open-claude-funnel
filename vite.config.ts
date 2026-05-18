import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./lib", import.meta.url)) } },
  ssr: { external: ["bun", "bun:sqlite"] },
  test: {
    server: { deps: { external: [/^bun(:|$)/] } },
    // These tests load Bun-runtime-only APIs (Bun.serve / bun:sqlite) through
    // their import chain. Vitest's Node workers cannot resolve `bun:*`
    // schemes, so they run via `bun test` instead (see Makefile bun-test).
    exclude: [
      "**/node_modules/**",
      "lib/cli/dispatch-claude.test.ts",
      "lib/funnel.test.ts",
      "lib/gateway/gateway-server.test.ts",
      "lib/gateway/funnel-event-store.test.ts",
      "lib/logger/leuco-logger-sqlite-sink.test.ts",
    ],
  },
  fmt: { semi: false },
  lint: {
    ignorePatterns: ["node_modules/**", "lib/**/*.test.ts", "lib/**/*.test.tsx"],
  },
  pack: {
    entry: {
      index: "lib/index.ts",
      "connectors/slack": "lib/connectors/slack.ts",
      "connectors/discord": "lib/connectors/discord.ts",
      "connectors/gh": "lib/connectors/gh.ts",
      "connectors/schedule": "lib/connectors/schedule.ts",
    },
    format: "esm",
    dts: true,
    deps: { neverBundle: ["bun", "bun:sqlite"] },
    outExtensions: () => ({ js: ".js" }),
  },
})
