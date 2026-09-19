import { CliError } from '../utils/error.utils.ts'
import { safeAsync } from '../utils/safe.utils.ts'
import { assertResolves, assertRunnable, planPath, readPlan } from '../lib/plan.ts'
import { formatVerdicts } from '../lib/report.ts'
import { runPlan } from '../lib/run.ts'

// Applies each planned mutation and reports what the suite noticed.
// A survivor is a finding to read rather than a gate to fail, so the exit code stays 0 either way.
export const run = async (path: string): Promise<void> => {
  const target = planPath(path)
  const plan = await readPlan(target)

  if (!plan) {
    throw new CliError(`No plan beside ${path}`, [
      `Run esmut stub ${path} to write one`,
    ])
  }

  assertRunnable(plan, target)

  const { data: source, error } = await safeAsync(() => Deno.readTextFile(path))

  if (error) {
    throw new CliError(`Cannot read ${path}`, [
      error.message,
      'The plan names the source it mutates',
    ])
  }

  assertResolves(plan, source, path, target)

  const verdicts = await runPlan(path, plan)

  console.log(formatVerdicts(path, verdicts))
}
