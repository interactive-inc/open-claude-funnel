import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/engine/yaml/yaml-render"

const requestHelp = `funnel channels <channel> connectors <connector> request / call a connector's outbound API

usage / funnel channels <channel> connectors <connector> request --method=<m> [--path=<p>] [--key=value ...]

options:
  --method / slack: API method (e.g. chat.postMessage). gh/discord: HTTP verb (GET/POST/...).
  --path / gh/discord: endpoint (e.g. repos/o/r/issues). Omit for slack (defaults to --method).

output / valid YAML (or raw text when the adapter returns text)`

export const channelsConnectorsRequestHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  helpGuard(requestHelp),
  zValidator(
    "query",
    z
      .object({
        method: z.string(),
        path: z.string().optional(),
      })
      .passthrough(),
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    const passthrough: Record<string, string> = {}

    for (const [k, v] of new URL(c.req.url).searchParams) {
      if (k === "method" || k === "path") continue
      passthrough[k] = v
    }

    // path falls back to method so slack (which ignores the HTTP verb and uses
    // path as the API method name) still works with just --method. gh/discord
    // need a distinct verb + endpoint, so they pass --path explicitly.
    const response = await funnel.channels.call(param.channel, param.connector, {
      method: query.method,
      path: query.path ?? query.method,
      body: passthrough,
    })

    return c.text(typeof response === "string" ? response : renderYaml(response))
  },
)
