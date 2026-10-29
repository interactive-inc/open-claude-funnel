export function requireIntegerLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative safe integer`)
  return value
}

export function requireDurationLimit(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative finite number`)
  return value
}
