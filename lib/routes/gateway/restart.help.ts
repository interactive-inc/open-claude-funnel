export const help = `funnel gateway restart — restart the gateway

usage: funnel gateway restart [--no-caffeine]

Stops the running process then starts it again in background.
On macOS wraps with caffeinate -i by default. Use --no-caffeine to disable.

examples:
  funnel gateway restart
  funnel gateway restart --no-caffeine`
