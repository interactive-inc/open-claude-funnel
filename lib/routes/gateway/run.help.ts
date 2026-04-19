export const help = `funnel gateway run — run the gateway in foreground

usage: funnel gateway run [--no-caffeine]

For developers. The process is tied to the current terminal and exits on SIGINT / SIGTERM.
On macOS wraps with caffeinate -i by default. Use --no-caffeine to disable.

For normal usage prefer funnel gateway start.

examples:
  funnel gateway run
  funnel gateway run --no-caffeine`
