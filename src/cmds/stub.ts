import { CliError } from '../utils/error.utils.ts'
import { safeAsync } from '../utils/safe.utils.ts'
import { formatStub } from '../lib/report.ts'
import { mergePlan, planPath, readPlan, writePlan } from '../lib/plan.ts'
import { stubPlan } from '../lib/stub.ts'

// Writes a plan naming every site a mutation could go, with the ops left empty.
// The addresses are mechanical and the meaning is not, so op, to, and name stay for the author.
export const stub = async (path: string): Promise<void> => {
  const { data: source, error } = await safeAsync(() => Deno.readTextFile(path))

  if (error) {
    throw new CliError(`Cannot read ${path}`, [
      error.message,
      'Name a TypeScript or JavaScript file to stub',
    ])
  }

  const stubbed = stubPlan(source, path)
  const target = planPath(path)

  // A plan already beside the source holds the ops and names someone wrote by hand.
  const existing = await readPlan(target)
  const merged = mergePlan(existing, stubbed, path)

  await writePlan(target, merged.plan)

  console.log(formatStub(target, merged))
}
