import { z } from "zod"

/** Known CLI spellings map explicitly to descriptor fields; custom fields pass through. */
export const connectorFieldsSchema = z
  .object({
    "bot-token": z.string().optional(),
    "app-token": z.string().optional(),
    "bot-token-env": z.string().optional(),
    "app-token-env": z.string().optional(),
    "token-env": z.string().optional(),
    "poll-interval": z.coerce.number().int().positive().optional(),
  })
  .loose()
  .transform((query) => {
    const aliases: Record<string, string> = {
      "bot-token": "botToken",
      "app-token": "appToken",
      "bot-token-env": "botTokenEnv",
      "app-token-env": "appTokenEnv",
      "token-env": "tokenEnv",
      "poll-interval": "pollInterval",
    }
    return Object.fromEntries(
      Object.entries(query)
        .filter((entry) => entry[1] !== undefined)
        .map(([key, value]) => [aliases[key] ?? key, value]),
    )
  })
