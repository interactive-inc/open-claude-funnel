type Field = { min: number; max: number; values: Set<number> }

const parseField = (expr: string, min: number, max: number): Field => {
  const values = new Set<number>()

  for (const part of expr.split(",")) {
    if (part.length === 0) throw new Error(`invalid empty cron list item: "${expr}"`)

    const stepSegments = part.split("/")
    if (stepSegments.length > 2) throw new Error(`invalid cron step: "${part}"`)

    const rangePart = stepSegments[0]
    const stepPart = stepSegments[1]
    if (stepSegments.length === 2 && stepPart === "") {
      throw new Error(`invalid cron step: "${part}"`)
    }

    const step = stepPart ? Number(stepPart) : 1

    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`invalid cron step: "${stepPart}"`)
    }

    let lo = min
    let hi = max

    if (rangePart === "*" || rangePart === undefined || rangePart === "") {
      lo = min
      hi = max
    } else if (rangePart.includes("-")) {
      const rangeSegments = rangePart.split("-")
      if (rangeSegments.length !== 2) throw new Error(`invalid cron range: "${rangePart}"`)

      const aStr = rangeSegments[0]
      const bStr = rangeSegments[1]
      const a = Number(aStr)
      const b = Number(bStr)

      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error(`invalid cron range: "${rangePart}"`)
      }

      lo = a
      hi = b
    } else {
      const n = Number(rangePart)

      if (!Number.isInteger(n)) throw new Error(`invalid cron value: "${rangePart}"`)

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

const parseCron = (
  expr: string,
): {
  minute: Field
  hour: Field
  dayOfMonth: Field
  month: Field
  dayOfWeek: Field
  dayOfMonthRestricted: boolean
  dayOfWeekRestricted: boolean
} => {
  const parts = expr.trim().split(/\s+/)

  if (parts.length !== 5) {
    throw new Error(`cron must have 5 fields (got ${parts.length}): "${expr}"`)
  }

  const [minute, hour, dom, month, dow] = parts

  if (!minute || !hour || !dom || !month || !dow) {
    throw new Error(`cron has empty fields: "${expr}"`)
  }

  return {
    minute: parseField(minute, 0, 59),
    hour: parseField(hour, 0, 23),
    dayOfMonth: parseField(dom, 1, 31),
    month: parseField(month, 1, 12),
    dayOfWeek: parseField(dow, 0, 7),
    dayOfMonthRestricted: dom !== "*",
    dayOfWeekRestricted: dow !== "*",
  }
}

/** Throws with a user-facing reason when `expr` is not a supported cron expression. */
export const validateCronExpression = (expr: string): void => {
  parseCron(expr)
}

/**
 * Returns true when `date` (local time) satisfies a standard 5-field cron
 * expression. Sunday accepts both 0 and 7. When day-of-month and day-of-week
 * are both restricted, either field matching is sufficient (Vixie cron).
 */
export const matchCron = (expr: string, date: Date): boolean => {
  const cron = parseCron(expr)

  if (!cron.minute.values.has(date.getMinutes())) return false
  if (!cron.hour.values.has(date.getHours())) return false
  if (!cron.month.values.has(date.getMonth() + 1)) return false

  const dayOfMonthMatches = cron.dayOfMonth.values.has(date.getDate())
  const day = date.getDay()
  const dayOfWeekMatches =
    cron.dayOfWeek.values.has(day) || (day === 0 && cron.dayOfWeek.values.has(7))

  if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) {
    return dayOfMonthMatches || dayOfWeekMatches
  }

  return dayOfMonthMatches && dayOfWeekMatches
}
