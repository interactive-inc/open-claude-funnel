import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const groupHelp = `funnel profiles — manage launch profiles

usage: funnel profiles [subcommand]

subcommands:
  (none)                          list (first entry is the default)
  add <name> --path <path> --channel <channel> [--agent ...] [--options ...] [--env ...] [--no-resume]
  <name> set [--path ...] [--channel ...] [--agent ...] [--options ...] [--env ...] [--resume|--no-resume]
  <name> as-default               move profile to the front (becomes default)
  rename <old> <new>              rename
  remove <name>                   remove
  <name> run                      launch (sugar for fnl claude -p <name>)
  <name>                          launch (alias for run)

A profile carries the launch recipe — \`--agent\` / \`--options\` prepended to
the claude argv, \`--env\` layered under the process, \`--resume\` toggling
session reuse. The channel it points at only declares transport (connectors).

examples:
  funnel profiles add cto --path /repo/myapp --channel prod-inbox --agent pm --options "--brief"
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
      const recipe = profile.options.length > 0 ? `, options=${profile.options.join(" ")}` : ""
      const session = profile.resume ? "" : ", resume=false"

      return `${profile.name}${tag}  [path=${profile.path}, channel=${profile.channelId}${recipe}${session}]`
    })

    return c.text(lines.join("\n"))
  },
)
