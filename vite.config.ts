import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./lib", import.meta.url)) } },
  fmt: { semi: false },
  lint: {
    ignorePatterns: [
      "node_modules/**",
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "lib/**/*.bun-test.ts",
    ],
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
