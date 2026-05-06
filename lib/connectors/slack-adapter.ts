import { WebClient } from "@slack/web-api";
import { FunnelConnectorAdapter, type CallInput } from "@/connectors/connector-adapter";
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema";

export type SlackWebClientLike = {
  apiCall: (method: string, options?: Record<string, unknown>) => Promise<unknown>;
};

const toRecord = (value: object): Record<string, unknown> => {
  const result: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(value)) result[key] = val;

  return result;
};

type Deps = {
  config: SlackConnectorConfig;
  client?: SlackWebClientLike;
};

export class FunnelSlackAdapter extends FunnelConnectorAdapter {
  private readonly client: SlackWebClientLike;

  constructor(deps: Deps) {
    super();
    this.client = deps.client ?? new WebClient(deps.config.botToken);
    Object.freeze(this);
  }

  async call(input: CallInput): Promise<unknown> {
    const body = input.body !== null && typeof input.body === "object" ? toRecord(input.body) : {};

    return await this.client.apiCall(input.path, body);
  }
}
