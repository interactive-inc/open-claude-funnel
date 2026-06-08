import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { renderYaml } from "@/cli/yaml-render"

const groupHelp = `funnel profiles / manage launch profiles

usage / funnel profiles [subcommand]

subcommands:
  (none) / list (first entry is the default)
  add <name> --path <path> --channel <channel> [--agent ...] [--options ...] [--env ...] [--no-resume]
  <name> set [--path ...] [--channel ...] [--agent ...] [--options ...] [--env ...] [--resume|--no-resume]
  <name> as-default / move profile to the front
  rename <old> <new> / rename
  remove <name> / remove
  <name> run / launch (sugar for fnl claude -p <name>)
  <name> / launch (alias for run)

A profile carries the launch recipe — --agent / --options prepended to the
claude argv, --env layered under the process, --resume toggling session
reuse. The channel it points at only declares transport (connectors).

output / valid YAML

programmable / funnel.profiles.list() / .add() / .remove() / .rename() / .setDefault()

examples:
  funnel profiles add cto --path /repo/myapp --channel prod-inbox --agent pm --options "--brief"
  funnel profiles cto as-default
  funnel profiles cto run`

export const profilesGroupHandler = factory.createHandlers(
  helpGuard(groupHelp),
  (c) => {
    const { profiles } = c.env
    const profileList = profiles.list()

    return c.text(
      renderYaml({
        profiles: profileList.map((profile, index) => ({
          name: profile.name,
          default: index === 0,
          path: profile.path,
          channelId: profile.channelId,
          options: profile.options,
          resume: profile.resume,
        })),
      }),
    )
  },
)
