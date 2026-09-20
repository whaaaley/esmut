import { basename, dirname, extname, join } from '@std/path'
import { CliError } from '../utils/error.utils.ts'
import { safe, safeAsync } from '../utils/safe.utils.ts'
import { select } from './select.ts'
import type { Stubbed } from './stub.ts'
import { type Mutation, OPS, type Plan, planSchema } from './schema.ts'

// operator and value carry a replacement; the other five are complete on their own.
const NEEDS_TO = ['operator', 'value'] as const

export const ESMUT_DIR = '.esmut'

// Plans live in one directory rather than beside their sources, since a plan is intent not code.
// The name carries the path it came from, so two sources sharing a basename do not collide.
export const planPath = (source: string): string => {
  const stem = basename(source, extname(source))
  const from = dirname(source).split('/').filter((part) => part !== '' && part !== '.' && part !== 'src')

  return join(ESMUT_DIR, [...from, `${stem}.json`].join('.'))
}

// The plan crosses in from a file, so it is checked rather than trusted.
export const parsePlan = (text: string, path: string): Plan => {
  const { data, error } = safe((): unknown => JSON.parse(text))

  if (error) {
    throw new CliError(`Cannot read the plan at ${path}`, [
      error.message,
      'A plan is json naming source, cmd, and mutations',
    ])
  }

  const { data: plan, error: invalid } = planSchema.safeParse(data)

  // Zod names the field that failed, which beats restating the whole shape.
  if (invalid) {
    throw new CliError(`The plan at ${path} is not the shape a run reads`, [
      ...invalid.issues.map((issue) => `${issue.path.join('.') || 'plan'}: ${issue.message}`),
    ])
  }

  return plan
}

// A selector resolving to anything but one node names no site, so its mutation never runs.
// Refusing the whole plan beats a verdict, since a stale entry beside a real one reads as real.
export const assertResolves = (plan: Plan, source: string, sourcePath: string, path: string): void => {
  const refused = plan.mutations
    .map((mutation) => ({ mutation, matches: select(source, sourcePath, mutation.at).length }))
    .filter((entry) => entry.matches !== 1)

  if (refused.length === 0) return

  const named = refused.slice(0, 3).map((entry) => (
    `${entry.matches === 0 ? 'stale    ' : 'ambiguous'}  ${entry.mutation.at}`
  ))

  const many = `${refused.length} selectors no longer resolve`
  const counted = refused.length === 1 ? '1 selector no longer resolves' : many

  throw new CliError(`${counted} in ${basename(path)}`, [
    ...named,
    `Run esmut check ${sourcePath} to see them all`,
    `Run esmut stub ${sourcePath} to re-address them`,
  ])
}

// Refusing a mutation the run cannot carry out here beats discovering it after the suite has run.
export const assertRunnable = (plan: Plan, path: string): void => {
  if (!plan.cmd) {
    throw new CliError(`The plan at ${path} names no cmd`, [
      'Name the test command the suite runs, which must fail when a mutation is caught',
      'stub leaves cmd empty because a command that cannot run reports every mutation as caught',
    ])
  }

  const unfilled = plan.mutations.find((mutation) => mutation.op === null)
  if (unfilled) {
    throw new CliError(`A mutation in ${path} names no op`, [
      `The site is ${unfilled.at}`,
      `Pick one of: ${OPS.join(', ')}`,
    ])
  }

  const missingTo = plan.mutations.find((mutation) => (
    NEEDS_TO.some((op) => op === mutation.op) && mutation.to === undefined
  ))

  if (missingTo) {
    throw new CliError(`A ${missingTo.op} mutation in ${path} names no replacement`, [
      `The site is ${missingTo.at}`,
      `${missingTo.op} needs a to field saying what replaces it`,
    ])
  }
}

// Absent is not an error: the first stub of a file has no plan to merge with.
export const readPlan = async (path: string): Promise<Plan | null> => {
  const { data, error } = await safeAsync(() => Deno.readTextFile(path))

  if (error) {
    if (error instanceof Deno.errors.NotFound) return null

    throw new CliError(`Cannot read the plan at ${path}`, [
      error.message,
      'Delete it to stub the file afresh',
    ])
  }

  return parsePlan(data, path)
}

// Written to a sibling and renamed, so an interrupted stub leaves the old plan intact.
// The temp file is a sibling rather than Deno.makeTempFile, since a cross-filesystem rename fails.
export const writePlan = async (path: string, plan: Plan): Promise<void> => {
  const temporary = `${path}.tmp`

  const { error } = await safeAsync(async () => {
    // The plans directory does not exist before the first stub, and a write into it would fail.
    await Deno.mkdir(dirname(path), { recursive: true })
    // JSON.stringify reads null and undefined in the replacer slot the same way, so a mutation of
    // the null below writes byte-identical json and is a mutant nothing can catch.
    await Deno.writeTextFile(temporary, `${JSON.stringify(plan, null, 2)}\n`)
    await Deno.rename(temporary, path)
  })

  if (error) {
    await safeAsync(() => Deno.remove(temporary))

    throw new CliError(`Cannot write the plan at ${path}`, [
      error.message,
      'The plan is written beside the source it names',
    ])
  }
}

// A selector that still resolves, to a node whose structure differs from the one the plan recorded.
// The op an author chose may no longer mean what they meant, so the change is reported.
export type Drift = {
  at: string
  before: string
  after: string
}

export type Merged = {
  plan: Plan
  kept: number
  added: number
  stale: Mutation[]
  drifted: Drift[]
}

// An existing plan holds ops and names someone chose, which a fresh stub must not discard.
// An entry whose selector no longer resolves is kept and reported.
// A stale address means the source moved rather than that the behavior stopped mattering.
export const mergePlan = (existing: Plan | null, stubbed: Stubbed, source: string): Merged => {
  const found = new Map(stubbed.mutations.map((mutation) => [mutation.at, mutation]))
  const previous = existing?.mutations ?? []

  const kept: Mutation[] = []
  const stale: Mutation[] = []
  const drifted: Drift[] = []

  // How many ops the stub derived rather than an author choosing them, which is what filledBy says.
  let supplied = 0

  for (const mutation of previous) {
    const match = found.get(mutation.at)

    if (!match) {
      stale.push(mutation)
      continue
    }

    // The selector resolves but the node changed, so the op may have shifted meaning.
    // The new structure is written and the old reported, since the plan records and the report tells.
    if (match.shape !== mutation.shape) drifted.push({ at: mutation.at, before: mutation.shape, after: match.shape })

    // An entry nobody has filled takes whatever the stub derived, where one carrying an op keeps it.
    // The op is the whole of an author's judgment, so overwriting a chosen one would discard it.
    const unfilled = mutation.op === null
    const carried = unfilled ? { op: match.op, ...(match.to ? { to: match.to } : {}) } : {}

    if (unfilled && match.op !== null) supplied += 1

    kept.push({ ...mutation, ...carried, shape: match.shape })
    found.delete(mutation.at)
  }

  const added = [...found.values()]

  // An op the stub derived is recorded as the stub's, so a reader knows to judge it before trusting
  // a verdict. An author's own marker stands, since sweep filling a plan outranks the stub's guess.
  const derived = supplied > 0 || added.some((mutation) => mutation.op !== null)
  const filledBy = existing?.filledBy ?? (derived ? 'stub' as const : undefined)

  return {
    plan: {
      source,
      cmd: existing?.cmd ?? '',
      ...(filledBy ? { filledBy } : {}),
      mutations: [...kept, ...stale, ...added],
    },
    kept: kept.length,
    added: added.length,
    stale,
    drifted,
  }
}
