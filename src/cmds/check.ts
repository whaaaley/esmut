import { CliError } from '../utils/error.utils.ts'
import { safeAsync } from '../utils/safe.utils.ts'
import { planPath, readPlan } from '../lib/plan.ts'
import { formatCheck } from '../lib/report.ts'
import { select } from '../lib/select.ts'

// Resolves every selector a plan names and reports what no longer matches, running no suite.
export const check = async (path: string): Promise<void> => {
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
}
