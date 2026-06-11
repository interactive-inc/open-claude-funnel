import { zValidator as honoZValidator } from "@hono/zod-validator"
import { HTTPException } from "hono/http-exception"
import type { ValidationTargets } from "hono"
import type { ZodType } from "zod"

const labelFor = (target: keyof ValidationTargets, key: string): string => {
  // Query params arrive from CLI flags, path params from positional args —
  // name them the way the user typed them, not the way Hono stores them.
  if (target === "query") return `--${key}`

  return `<${key}>`
}

const formatIssues = (
  target: keyof ValidationTargets,
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string => {
  const lines = issues.map((issue) => {
    const key = issue.path.map(String).join(".")

    if (!key) return issue.message

    return `${labelFor(target, key)}: ${issue.message}`
  })

  return `invalid arguments — ${lines.join("; ")} (run with --help for usage)`
}

/**
 * CLI-flavored zValidator: every route imports this instead of the raw
 * @hono/zod-validator so a validation failure renders as one readable line
 * naming the offending flag, not a raw ZodError JSON dump.
 */
export const zValidator = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) =>
  honoZValidator(target, schema, (result) => {
    if (result.success) return

    throw new HTTPException(400, { message: formatIssues(target, result.error.issues) })
  })
