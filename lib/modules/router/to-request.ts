const SHORT_FLAGS: Record<string, string> = {
  h: "help",
  n: "name",
}

const STRIPPED_METHOD_KEYWORDS: Record<string, string> = {
  add: "POST",
  remove: "DELETE",
  set: "PUT",
  update: "PUT",
}

const KEPT_METHOD_KEYWORDS: Record<string, string> = {
  rename: "PUT",
  attach: "PUT",
  detach: "DELETE",
  default: "PUT",
}

const API_CALL_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"])

const isValue = (arg: string | undefined): arg is string => {
  return typeof arg === "string" && !arg.startsWith("-")
}

const consumeApiCall = (args: string[], i: number, params: URLSearchParams): number => {
  params.set("method", args[i]!)

  const nextPath = args[i + 1]

  if (!isValue(nextPath)) return 1

  params.set("path", nextPath)

  const nextBody = args[i + 2]

  if (!isValue(nextBody)) return 2

  params.set("body", nextBody)

  return 3
}

export const toRequest = (args: string[]) => {
  const segments: string[] = []
  const params = new URLSearchParams()
  let method = "GET"

  let i = 0
  while (i < args.length) {
    const arg = args[i]!

    if (arg.startsWith("--")) {
      const key = arg.slice(2)
      const next = args[i + 1]

      if (isValue(next)) {
        params.set(key, next)
        i += 2
      } else {
        params.set(key, "true")
        i++
      }

      continue
    }

    if (arg.startsWith("-") && arg.length === 2) {
      const long = SHORT_FLAGS[arg[1]!]

      if (!long) {
        i++
        continue
      }

      const next = args[i + 1]

      if (isValue(next)) {
        params.set(long, next)
        i += 2
      } else {
        params.set(long, "true")
        i++
      }

      continue
    }

    if (STRIPPED_METHOD_KEYWORDS[arg]) {
      method = STRIPPED_METHOD_KEYWORDS[arg]!
      i++
      continue
    }

    if (KEPT_METHOD_KEYWORDS[arg]) {
      method = KEPT_METHOD_KEYWORDS[arg]!
      segments.push(arg)
      i++
      continue
    }

    if (API_CALL_METHODS.has(arg) && !params.has("method")) {
      segments.push("call")
      i += consumeApiCall(args, i, params)
      continue
    }

    if (arg.includes("/") && !params.has("path")) {
      params.set("path", arg)
      i++
      continue
    }

    segments.push(arg)
    i++
  }

  const path = segments.length > 0 ? `/${segments.join("/")}` : "/"
  const query = params.size > 0 ? `?${params}` : ""

  return { method, path, url: `http://localhost${path}${query}` }
}
