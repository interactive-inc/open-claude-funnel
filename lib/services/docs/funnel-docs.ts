import { docsArchitecture } from "@/services/docs/topics/docs-architecture"
import { docsChannels } from "@/services/docs/topics/docs-channels"
import { docsClaude } from "@/services/docs/topics/docs-claude"
import { docsConnectors } from "@/services/docs/topics/docs-connectors"
import { docsDebugging } from "@/services/docs/topics/docs-debugging"
import { docsGateway } from "@/services/docs/topics/docs-gateway"
import { docsGlossary } from "@/services/docs/topics/docs-glossary"
import { docsLocalConfig } from "@/services/docs/topics/docs-local-config"
import { docsMcp } from "@/services/docs/topics/docs-mcp"
import { docsProfiles } from "@/services/docs/topics/docs-profiles"
import { docsProgrammableApi } from "@/services/docs/topics/docs-programmable-api"
import { docsRecipes } from "@/services/docs/topics/docs-recipes"

const DOCS: Record<string, string> = {
  architecture: docsArchitecture,
  channels: docsChannels,
  claude: docsClaude,
  connectors: docsConnectors,
  debugging: docsDebugging,
  gateway: docsGateway,
  glossary: docsGlossary,
  "local-config": docsLocalConfig,
  mcp: docsMcp,
  profiles: docsProfiles,
  "programmable-api": docsProgrammableApi,
  recipes: docsRecipes,
}

const SUMMARIES: Record<string, string> = {
  architecture: "how Funnel routes events end-to-end",
  channels: "what a channel is and how delivery modes work",
  connectors: "external service bindings nested in channels",
  profiles: "named Claude launch presets",
  claude: "fnl claude resolution order and argv assembly",
  mcp: "the MCP server, inbound notifications, outbound tools",
  gateway: "the WebSocket + HTTP daemon",
  "local-config": "the per-repo funnel.json file",
  debugging: "ladder for diagnosing event delivery problems",
  "programmable-api": "Funnel as an SDK; build your own CLI/UI on the engine",
  recipes: "common task playbooks",
  glossary: "vocabulary reference",
}

export type DocsTopicListing = {
  name: string
  summary: string
}

/**
 * Programmable docs surface — used by both the CLI (fnl docs <topic>) and the
 * MCP / SDK consumers. Docs are embedded into the build so a Claude session
 * can self-discover funnel's vocabulary without external network access.
 */
export class FunnelDocs {
  constructor() {
    Object.freeze(this)
  }

  list(): DocsTopicListing[] {
    return Object.keys(DOCS)
      .sort()
      .map((name) => ({ name, summary: SUMMARIES[name] ?? "" }))
  }

  get(topic: string): string | null {
    return DOCS[topic] ?? null
  }

  topics(): string[] {
    return Object.keys(DOCS).sort()
  }
}
