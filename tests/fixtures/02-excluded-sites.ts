// The three exclusion rules, each with a literal that would be a site anywhere else in the file.
// A message string, an import specifier, and a property key all sit beside a literal that is a site.

import { join } from '@std/path'

export const persist = (dir: string, attempt: number): string => {
  console.log('writing the cache to disk')

  if (attempt > 3) {
    throw new Error('too many attempts while writing the cache')
  }

  const settings = { mode: 'append', depth: 2 }

  return join(dir, settings.mode)
}
