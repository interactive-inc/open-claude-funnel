export const help = `funnel gateway logs — tail event logs

usage: funnel gateway logs [-n <N>]

options:
  -n <N>                number of trailing lines to show (default: 20)

Tails the latest /tmp/funnel/events/*.jsonl file. Exit with SIGINT.
Output is formatted as YAML.

examples:
  funnel gateway logs
  funnel gateway logs -n 100`
