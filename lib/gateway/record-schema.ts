import { z } from "zod"

const recordShape = z.record(z.string(), z.unknown())

/** Validate every own key, including names the default record parser omits. */
export function recordSchema<T>(valueSchema: z.ZodType<T>) {
  const schema = z.unknown().transform((input, context): Record<string, T> => {
    const snapshot =
      input !== null && typeof input === "object" && !Array.isArray(input)
        ? Object.setPrototypeOf({ ...input }, Object.getPrototypeOf(input))
        : input
    const shape = recordShape.safeParse(snapshot)
    if (!shape.success) {
      for (const issue of shape.error.issues) context.addIssue({ ...issue })
      return z.NEVER
    }
    const entries: [string, T][] = []
    for (const [key, value] of Object.entries(snapshot as Record<string, unknown>)) {
      const parsed = valueSchema.safeParse(value)
      if (!parsed.success) {
        for (const issue of parsed.error.issues)
          context.addIssue({ ...issue, path: [key, ...issue.path] })
      } else entries.push([key, parsed.data])
    }
    return Object.fromEntries(entries)
  })
  // Runtime validation accepts unknown input; callers retain the typed dictionary contract.
  return schema as z.ZodType<Record<string, T>, Record<string, T>>
}
