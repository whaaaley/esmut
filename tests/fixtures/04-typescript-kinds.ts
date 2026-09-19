// TS-only kinds, which estraverse names no children for and esquery cannot descend into without visitorKeys.
// The sites sit under a type alias, a generic, an as expression, and an enum, where an unreachable node reads as stale.

export interface Budget {
  limit: number
  label: string
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; reason: string }

export enum Level {
  Low = 1,
  High = 2,
}

export const clamp = <T extends Budget>(input: T, ceiling: number): Outcome<number> => {
  if (input.limit > ceiling) return { ok: false, reason: 'over the ceiling' }

  const raw = input as Budget
  const scaled = (raw.limit * 2) as number

  return { ok: true, value: scaled }
}

export const describe = (level: Level): string => level === Level.High ? 'high' : 'low'
