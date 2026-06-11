import { z } from "zod"

/**
 * One parser for every CLI boolean flag: bare `--flag` (and `--flag=true`)
 * mean true, `--flag=false` means false, absent stays undefined so routes can
 * distinguish "not given" from "explicitly off". `""` survives for callers
 * that hit the HTTP surface directly with `?flag=`.
 */
export const booleanFlag = z
  .enum(["true", "false", ""])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined

    return value !== "false"
  })
