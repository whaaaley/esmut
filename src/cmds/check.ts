import { CliError } from '../utils/error.utils.ts'
import { safeAsync } from '../utils/safe.utils.ts'
import { planPath, readPlan, writePlan } from '../lib/plan.ts'
import { formatCheck, formatPruned } from '../lib/report.ts'
import { select } from '../lib/select.ts'

export type CheckOptions = {
  prune?: boolean
}

// Resolves every selector a plan names and reports what no longer matches, running no suite.
// With prune it also drops the entries naming nothing, which is the one thing it writes.
export const check = async (path: string, options: CheckOptions = {}): Promise<void> => {
  const target = planPath(path)
  const plan = await readPlan(target)

  if (!plan) {
    throw new CliError(`No plan beside ${path}`, [
      `Run esmut stub ${path} to write one`,
    ])
  }

  const { data: source, error } = await safeAsync(() => Deno.readTextFile(path))

  if (error) {
    throw new CliError(`Cannot read ${path}`, [
      error.message,
      'The plan names the source it mutates',
    ])
  }

  const resolved = plan.mutations.map((mutation) => ({
    mutation,
    matches: select(source, path, mutation.at).length,
  }))

  console.log(formatCheck(path, resolved))

  if (!options.prune) return

  // Only an entry matching nothing is dropped. An ambiguous one names a node that is still there,
  // so it is a selector to narrow rather than work to delete.
  const gone = resolved.filter((entry) => entry.matches === 0)
  if (gone.length === 0) return

  const kept = resolved.filter((entry) => entry.matches !== 0).map((entry) => entry.mutation)

  await writePlan(target, { ...plan, mutations: kept })

  console.log(formatPruned(gone.map((entry) => entry.mutation)))
}
