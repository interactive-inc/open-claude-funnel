import { createFactory } from "hono/factory"
import type { Funnel } from "@/funnel"

export type Env = {
  Variables: {
    funnel: Funnel
  }
}

export const factory = createFactory<Env>()
