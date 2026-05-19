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
 * speak to different Slack apps. The daemon advertises its dir via the
 * `funnel-gateway[<dir>]` marker appended to argv (also assigned to
 * `process.title` on POSIX). `FunnelProcessRunner.listProcessesContaining`
 * absorbs the POSIX/Windows enumeration difference behind the marker match.
 */
export const killCompetingSlackGateways = async (props: Props): Promise<number[]> => {
  const runner = props.process ?? defaultProcess
  const logger = props.logger ?? defaultLogger
  const expectedTitle = titleFor(props.dir)
  const snapshots = runner.listProcessesContaining(expectedTitle)
  const killed: number[] = []

  for (const snapshot of snapshots) {
    if (snapshot.pid === props.selfPid) continue

    runner.kill(snapshot.pid, "SIGTERM")
    killed.push(snapshot.pid)

    logger.info("killed competing Slack gateway process", {
      pid: snapshot.pid,
      args: snapshot.command.slice(0, 160),
    })
  }

  return killed
}
