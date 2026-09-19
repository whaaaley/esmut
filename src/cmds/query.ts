import { CliError } from '../utils/error.utils.ts'
import { safeAsync } from '../utils/safe.utils.ts'
import { formatMatches } from '../lib/report.ts'
import { select } from '../lib/select.ts'

// Prints what a selector matches, so a selector can be narrowed until the count is 1.
// The count is the point: 0 is stale, more than 1 is ambiguous, and both are refused by a run.
export const query = async (path: string, selector: string): Promise<void> => {
  const { data: source, error } = await safeAsync(() => Deno.readTextFile(path))

  if (error) {
    throw new CliError(`Cannot read ${path}`, [
      error.message,
      'Name a TypeScript or JavaScript file to query',
    ])
  }

  const matches = select(source, path, selector)

  console.log(formatMatches(path, matches))
}
