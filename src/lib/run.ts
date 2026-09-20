import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { CliError } from '../utils/error.utils.ts'
import { safe, safeAsync } from '../utils/safe.utils.ts'
import { diagnose, introduced, openGate } from './check.ts'
import type { Diagnostic, Gate } from './check.ts'
import { applyOp } from './ops.ts'
import { matchesNode } from './query.ts'
import type { Mutation, Plan } from './schema.ts'
import { parseSelector } from './select.ts'
import { indexSource } from './walk.ts'
import type { Indexed } from './walk.ts'

export type Verdict = {
  mutation: Mutation
  outcome: 'killed' | 'survived' | 'invalid' | 'stale' | 'ambiguous'
  // What the gate objected to, when the mutant did not compile.
  because?: string
}

export type Suite = (cmd: string) => Promise<boolean>

// Inverting a loop guard is one of the seven ops, and a loop whose guard never goes false does not
// return, so a mutant that hangs the suite is a shape this tool produces rather than an oddity.
// A run waiting on one waits forever, which is why the wait is bounded and the timeout is a verdict.
const SUITE_TIMEOUT_MS = 120_000

export class SuiteTimeout extends Error {
  constructor(readonly ms: number) {
    super(`The suite did not finish within ${ms}ms`)
    this.name = this.constructor.name
  }
}

// A caught mutation is one the suite failed on, so a suite that cannot run catches everything.
// A suite that never finishes throws instead, since no exit code says whether it caught anything.
export const suiteFails = async (cmd: string, timeoutMs = SUITE_TIMEOUT_MS): Promise<boolean> => {
  const [bin, ...rest] = cmd.split(' ')

  if (!bin) {
    throw new CliError('The plan names an empty cmd', [
      'Name the test command the suite runs',
    ])
  }

  // The child is killed on the signal rather than left running, since a hung mutant holds a port
  // or a lock the next mutation needs, and an orphan outlives the run that started it.
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), timeoutMs)

  const command = new Deno.Command(bin, { args: rest, stdout: 'null', stderr: 'null', signal: stop.signal })
  const { data, error } = await safeAsync(() => command.output())

  clearTimeout(timer)

  if (error) throw error

  // Killing the child resolves with its signal rather than throwing, and the code it carries is
  // non-zero. Reading that as a failing suite would report a mutant nothing caught as killed.
  if (stop.signal.aborted) throw new SuiteTimeout(timeoutMs)

  return data.code !== 0
}

export type Judged = {
  source: string
  path: string
  indexed: Indexed
  nodes: TSESTree.Node[]
  gate: Gate
  clean: Diagnostic[]
}

// The source, its walk, and its diagnostics are the same for every mutation in a plan.
// Judging them once rather than per mutation is what keeps a run off the parse and the gate.
// The gate is held open across the plan, so each mutant reparses itself rather than its imports.
export const prepare = (source: string, path: string): Judged => {
  const indexed = indexSource(source, path)
  const gate = openGate(path)

  return {
    source,
    path,
    indexed,
    nodes: [...indexed.byType.values()].flat(),
    gate,
    clean: diagnose(gate, source),
  }
}

// Judges one mutation without writing anything, so a verdict needing no suite costs no disk.
export const judge = (judged: Judged, mutation: Mutation): { verdict: Verdict } | { mutant: string } => {
  const { source, indexed, nodes, gate, clean } = judged

  const selector = parseSelector(mutation.at)

  // Matched against the walk rather than a fresh parse, which is the same set select would return.
  const matched = nodes.filter((candidate) => (
    matchesNode(candidate, selector, indexed.ancestry.get(candidate) ?? [])
  ))

  if (matched.length === 0) return { verdict: { mutation, outcome: 'stale' } }
  if (matched.length > 1) return { verdict: { mutation, outcome: 'ambiguous' } }

  const [node] = matched
  if (!node) return { verdict: { mutation, outcome: 'stale' } }

  const { data: mutant, error } = safe(() => applyOp(source, node, mutation))

  // A no-op reads as survived while changing nothing, so it is reported invalid rather than run.
  // An op the node cannot take is reported the same way rather than thrown.
  // One bad entry would otherwise abort the run and lose every verdict after it.
  if (error) return { verdict: { mutation, outcome: 'invalid', because: error.message } }

  const fresh = introduced(clean, diagnose(gate, mutant))
  const [first] = fresh

  if (first) {
    return { verdict: { mutation, outcome: 'invalid', because: first.message } }
  }

  return { mutant }
}

// Writes each mutant, runs the suite, and restores on the way out whether or not the run finished.
export const runPlan = async (path: string, plan: Plan, suite: Suite = suiteFails): Promise<Verdict[]> => {
  const { data: source, error } = await safeAsync(() => Deno.readTextFile(path))

  if (error) {
    throw new CliError(`Cannot read ${path}`, [
      error.message,
      'The plan names the source it mutates',
    ])
  }

  const verdicts: Verdict[] = []
  const judged = prepare(source, path)

  // A signal does not unwind the stack, so finally never runs and the mutant on disk survives.
  // Restoring from the handler is what makes the promise in the comment below true for a kill.
  const restore = (): void => {
    Deno.writeTextFileSync(path, source)
    Deno.exit(130)
  }

  Deno.addSignalListener('SIGINT', restore)
  Deno.addSignalListener('SIGTERM', restore)

  let unrestored: Error | null = null

  // The restore runs on a throw as well as a return, so no interrupted run leaves a mutant on disk.
  // It is reported after the try rather than from the finally, which would replace the loop's throw.
  try {
    for (const mutation of plan.mutations) {
      const outcome = judge(judged, mutation)

      if ('verdict' in outcome) {
        verdicts.push(outcome.verdict)
        continue
      }

      await Deno.writeTextFile(path, outcome.mutant)
      const { data: caught, error: ran } = await safeAsync(() => suite(plan.cmd))

      // Restored per mutation rather than once at the end, so the next suite reads the source and
      // not the mutant before it. A failure here is left to the finally and the report after it,
      // since a raw throw would reach the caller as whatever the filesystem said.
      const { error: unwritten } = await safeAsync(() => Deno.writeTextFile(path, source))
      if (unwritten) break

      // A mutant that hangs the suite is this mutation's verdict rather than the whole plan's error,
      // so the run carries on. It reads as invalid because no exit code said whether it was caught,
      // which is the same reason a mutant refused by the type gate reads that way.
      if (ran instanceof SuiteTimeout) {
        verdicts.push({ mutation, outcome: 'invalid', because: ran.message })
        continue
      }

      if (ran) throw ran

      verdicts.push({ mutation, outcome: caught ? 'killed' : 'survived' })
    }
  } finally {
    // The loop restores after each suite, so this is usually reached with the source already back.
    // It is the only restore where that write threw, such as a source the run cannot write to.
    // The failure is held rather than thrown, since a throw from a finally replaces whatever the
    // loop was already throwing and loses it.
    const { error } = await safeAsync(() => Deno.writeTextFile(path, source))
    unrestored = error

    // The SIGTERM removal is tested by the exit code a later signal gives: 143 by default against
    // 130 from a handler left behind. SIGINT has no such tell, since Deno's own default for it also
    // exits 130, so a mutation of the line below is a mutant no test can catch.
    Deno.removeSignalListener('SIGINT', restore)
    Deno.removeSignalListener('SIGTERM', restore)
  }

  // Named rather than swallowed, since a mutant left on disk is the one failure that outlives the
  // run, and a verdict list is worth less than knowing the source was not put back.
  if (unrestored) {
    throw new CliError(`Cannot restore ${path}`, [
      unrestored.message,
      'The file holds a mutant rather than the source it was read from',
    ])
  }

  return verdicts
}
