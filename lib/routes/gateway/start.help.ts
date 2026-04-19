export const help = `funnel gateway start — start the gateway in background

usage: funnel gateway start [--no-caffeine]

Daemonized with nohup, so it keeps running after the terminal is closed.
On macOS wraps the process with caffeinate -i by default to prevent idle sleep.
Use --no-caffeine to disable caffeinate.

port: 9742 (override via FUNNEL_PORT)
pid:  ~/.funnel/gateway.pid
log:  /tmp/funnel/gateway.log

examples:
  funnel gateway start
  funnel gateway start --no-caffeine`
