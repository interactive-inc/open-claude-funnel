import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/engine/yaml/yaml-render"

const docsHelp = `funnel docs / embedded documentation

usage / funnel docs [topic]

with no topic, lists topics as YAML. with a topic, prints the doc text.

output / valid YAML (topic listing) or plain text (topic body)

programmable / funnel.docs.list() / funnel.docs.get(topic)

examples:
  funnel docs
  funnel docs architecture
  funnel docs debugging`

export const docsIndexHandler = factory.createHandlers(
  helpGuard(docsHelp),
  async (c) => {
    const docs = c.env.funnel.docs

    return c.text(renderYaml({ topics: docs.list() }))
  },
)

export const docsTopicHandler = factory.createHandlers(
  zValidator("param", z.object({ topic: z.string() })),
  async (c) => {
    const param = c.req.valid("param")
    const docs = c.env.funnel.docs
    const text = docs.get(param.topic)

    if (text === null) {
      return c.text(
        renderYaml({
          error: `unknown topic: ${param.topic}`,
          availableTopics: docs.topics(),
        }),
      )
    }

    return c.text(text)
  },
)
