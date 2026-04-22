type Field = { min: number; max: number; values: Set<number> }

const parseField = (expr: string, min: number, max: number): Field => {
  const values = new Set<number>()

  for (const part of expr.split(",")) {
    const [rangePart, stepPart] = part.split("/")
    const step = stepPart ? Number(stepPart) : 1

    if (!Number.isFinite(step) || step <= 0) {
      throw new Error(`invalid cron step: "${stepPart}"`)
    }

    let lo = min
    let hi = max

    if (rangePart === "*" || rangePart === undefined || rangePart === "") {
      lo = min
      hi = max
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-").map(Number)

      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new Error(`invalid cron range: "${rangePart}"`)
      }

      lo = a as number
      hi = b as number
    } else {
      const n = Number(rangePart)

      if (!Number.isFinite(n)) throw new Error(`invalid cron value: "${rangePart}"`)

      lo = n
      hi = stepPart ? max : n
    }

    if (lo < min || hi > max || lo > hi) {
      throw new Error(`cron value out of range: ${rangePart} (must be ${min}-${max})`)
    }

    for (let i = lo; i <= hi; i += step) {
      values.add(i)
    }
  }

  return { min, max, values }
}

export const matchCron = (expr: string, date: Date): boolean => {
  const parts = expr.trim().split(/\s+/)

  if (parts.length !== 5) {
    throw new Error(`cron must have 5 fields (got ${parts.length}): "${expr}"`)
  }

  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string]

  const fields = [
    { field: parseField(minute, 0, 59), value: date.getMinutes() },
    { field: parseField(hour, 0, 23), value: date.getHours() },
    { field: parseField(dom, 1, 31), value: date.getDate() },
    { field: parseField(month, 1, 12), value: date.getMonth() + 1 },
    { field: parseField(dow, 0, 6), value: date.getDay() },
  ]

  for (const { field, value } of fields) {
    if (!field.values.has(value)) return false
  }

  return true
}
