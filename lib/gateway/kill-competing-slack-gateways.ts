import { FunnelLogger } from "@/engine/logger/logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"

type Props = {
  selfPid: number
  /** Funnel home directory. Only daemons rooted at the same dir share Slack tokens and are killed. */
  dir: string
  process?: FunnelProcessRunner
  logger?: FunnelLogger
}

const defaultProcess = new NodeFunnelProcessRunner()
const defaultLogger = new NodeFunnelLogger()

const titleFor = (dir: string): string => `funnel-gateway[${dir}]`

/**
 * Kills other funnel daemon processes that share the SAME funnel home dir,
 * which is the only situation that causes a real conflict (duplicate Slack
 * Socket Mode connections with the same tokens). Daemons rooted at a
 * different `~/.funnel/` are left alone — they hold different tokens and
 * speak to different Slack apps. The daemon advertises its dir via
 * `process.title = "funnel-gateway[<dir>]"`, which this routine matches.
 */
export const killCompetingSlackGateways = async (props: Props): Promise<number[]> => {
  const runner = props.process ?? defaultProcess
  const logger = props.logger ?? defaultLogger
  const result = await runner.run(["ps", "-e", "-o", "pid=,args="])

  if (result.exitCode !== 0) return []

  const expectedTitle = titleFor(props.dir)
  const killed: number[] = []

  for (const raw of result.stdout.split("\n")) {
    const line = raw.trim()

    if (!line) continue

    const match = /^(\d+)\s+(.+)$/.exec(line)

    if (!match) continue

    const pid = Number(match[1])
    const args = match[2]!

    if (!Number.isInteger(pid) || pid <= 0) continue
    if (pid === props.selfPid) continue
    if (!args.includes(expectedTitle)) continue

    runner.kill(pid, "SIGTERM")
    killed.push(pid)

    logger.info("killed competing Slack gateway process", { pid, args: args.slice(0, 160) })
  }

  return killed
}
