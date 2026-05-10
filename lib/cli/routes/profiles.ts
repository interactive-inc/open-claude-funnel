import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const groupHelp = `funnel profiles — manage launch profiles

usage: funnel profiles [subcommand]

subcommands:
  (none)                          list (first entry is the default)
  add <name> --path <path> --sub-agent <agent> --channel <channel>
  <name> set [--path ...] [--sub-agent ...] [--channel ...]
  <name> as-default               move profile to the front (becomes default)
  rename <old> <new>              rename
  remove <name>                   remove
  <name> run                      launch (sugar for fnl claude -p <name>)
  <name>                          launch (alias for run)

examples:
  funnel profiles add cto --path /repo/myapp --sub-agent cto --channel prod-inbox
  funnel profiles cto as-default
  funnel profiles cto run`

export const profilesGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), groupHelp),
  (c) => {
    const funnel = c.var.funnel
    const profiles = funnel.profiles.list()

    if (profiles.length === 0) return c.text("no profiles")

    const lines = profiles.map((profile, index) => {
      const tag = index === 0 ? " (default)" : ""

      return `${profile.name}${tag}  [path=${profile.path}, sub-agent=${profile.subAgent}, channel=${profile.channelId}]`
    })

    return c.text(lines.join("\n"))
  },
)
