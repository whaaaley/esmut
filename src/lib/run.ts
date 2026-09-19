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

// A caught mutation is one the suite failed on, so a suite that cannot run catches everything.
export const suiteFails = async (cmd: string): Promise<boolean> => {
  const [bin, ...rest] = cmd.split(' ')

  if (!bin) {
    throw new CliError('The plan names an empty cmd', [
      'Name the test command the suite runs',
    ])
  }

  const command = new Deno.Command(bin, { args: rest, stdout: 'null', stderr: 'null' })
  const { code } = await command.output()

  return code !== 0
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

  // The restore runs on a throw as well as a return, so no interrupted run leaves a mutant on disk.
  try {
    for (const mutation of plan.mutations) {
      const outcome = judge(judged, mutation)

      if ('verdict' in outcome) {
        verdicts.push(outcome.verdict)
        continue
      }

      await Deno.writeTextFile(path, outcome.mutant)
      const caught = await suite(plan.cmd)
      await Deno.writeTextFile(path, source)

      verdicts.push({ mutation, outcome: caught ? 'killed' : 'survived' })
    }
  } finally {
    await Deno.writeTextFile(path, source)

    Deno.removeSignalListener('SIGINT', restore)
    Deno.removeSignalListener('SIGTERM', restore)
  }

  return verdicts
}
