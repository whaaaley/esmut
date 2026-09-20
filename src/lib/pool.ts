import { CliError } from '../utils/error.utils.ts'
import { safeAsync } from '../utils/safe.utils.ts'
import { openSandbox } from './sandbox.ts'
import { judge, prepare, suiteFails, SuiteTimeout } from './run.ts'
import type { Suite, Verdict } from './run.ts'
import type { Mutation, Plan } from './schema.ts'

// How many sandboxes a run opens, which is how many suites it has in flight.
// One per core leaves nothing for the suites themselves, so the count stays under it.
const WORKERS = 4

// A mutation the gate passed, waiting on a suite to say whether anything caught it.
// The slot is where its verdict belongs, since workers finish in whatever order the suites do.
type Pending = {
  mutation: Mutation
  mutant: string
  slot: number
}

export type PoolOptions = {
  workers: number
  suite: Suite
}

// Judges every mutation, then runs the suites that survived the gate across sandboxes at once.
// Judging is pure and costs milliseconds, where a suite costs half a second, so only suites split.
// The tree is never written, which is what lets the suites overlap at all.
export const runPool = async (path: string, plan: Plan, options: Partial<PoolOptions> = {}): Promise<Verdict[]> => {
  const { workers = WORKERS, suite = suiteFails } = options

  const { data: source, error } = await safeAsync(() => Deno.readTextFile(path))

  if (error) {
    throw new CliError(`Cannot read ${path}`, [
      error.message,
      'The plan names the source it mutates',
    ])
  }

  const judged = prepare(source, path)

  // Sized to the plan and filled by slot, so the report reads in plan order whatever order the
  // suites finish in.
  const slotted: (Verdict | undefined)[] = plan.mutations.map(() => undefined)
  const pending: Pending[] = []

  plan.mutations.forEach((mutation, slot) => {
    const outcome = judge(judged, mutation)

    if ('verdict' in outcome) {
      slotted[slot] = outcome.verdict
      return
    }

    pending.push({ mutation, mutant: outcome.mutant, slot })
  })

  const filled = (): Verdict[] => slotted.filter((verdict): verdict is Verdict => verdict !== undefined)

  if (pending.length === 0) return filled()

  const root = Deno.cwd()
  let next = 0

  // One sandbox per worker rather than per mutation, since opening one costs more than a suite run.
  const work = async (): Promise<void> => {
    await using box = await openSandbox(root, path)

    while (next < pending.length) {
      const taken = pending[next]
      next += 1

      if (!taken) continue

      await Deno.writeTextFile(box.path, taken.mutant)
      const { data: caught, error: ran } = await safeAsync(() => suite(plan.cmd, { cwd: box.root }))

      // A mutant that hangs the suite is this mutation's verdict rather than the whole run's error.
      if (ran instanceof SuiteTimeout) {
        slotted[taken.slot] = { mutation: taken.mutation, outcome: 'invalid', because: ran.message }
        continue
      }

      if (ran) throw ran

      slotted[taken.slot] = { mutation: taken.mutation, outcome: caught ? 'killed' : 'survived' }
    }
  }

  const running: Promise<void>[] = []
  for (let worker = 0; worker < Math.min(workers, pending.length); worker++) {
    running.push(work())
  }

  await Promise.all(running)

  return filled()
}
