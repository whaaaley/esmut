import { dirname, join, resolve } from '@std/path'
import { CliError } from '../utils/error.utils.ts'
import { safeAsync } from '../utils/safe.utils.ts'

// What a copy of the tree needs to run a suite, beyond the sources a mutation touches.
// node_modules is linked rather than copied, since no mutant reaches into a dependency.
const COPIED: readonly string[] = ['src', 'tests', 'deno.json', 'deno.lock']
const LINKED: readonly string[] = ['node_modules']

// Named because it recurses, which is the one thing a call site cannot show.
const copyTree = async (from: string, to: string): Promise<void> => {
  await Deno.mkdir(to, { recursive: true })

  for await (const entry of Deno.readDir(from)) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)

    if (entry.isDirectory) {
      await copyTree(source, target)
      continue
    }

    await Deno.copyFile(source, target)
  }
}

export type Sandbox = {
  // The copy's root, which a suite runs with as its working directory.
  root: string
  // Where the mutated source lives inside the copy, so a worker writes there instead of the tree.
  path: string
  [Symbol.asyncDispose]: () => Promise<void>
}

// A copy of the tree a worker owns, so one worker's mutant is invisible to the others.
// Mutating the tree in place is what made a run serial, since two mutants cannot share one file.
export const openSandbox = async (root: string, source: string): Promise<Sandbox> => {
  const { data: made, error: unmade } = await safeAsync(() => Deno.makeTempDir({ prefix: 'esmut-' }))

  if (unmade) {
    throw new CliError('Cannot create a sandbox for the run', [
      unmade.message,
      'A sandbox is a copy of the tree a worker mutates instead of the tree itself',
    ])
  }

  // The sources are copied because a worker writes a mutant into them, where a link would write
  // through to the tree. The dependencies are linked because nothing writes to them.
  const populate = async (): Promise<void> => {
    for (const entry of COPIED) {
      const from = join(root, entry)
      const { data: stat, error } = await safeAsync(() => Deno.lstat(from))

      if (error) continue

      const to = join(made, entry)

      if (stat.isDirectory) {
        await copyTree(from, to)
        continue
      }

      await Deno.mkdir(dirname(to), { recursive: true })
      await Deno.copyFile(from, to)
    }

    for (const entry of LINKED) {
      const from = join(root, entry)
      const { error } = await safeAsync(() => Deno.lstat(from))

      if (error) continue

      await Deno.symlink(resolve(from), join(made, entry))
    }
  }

  const { error: uncopied } = await safeAsync(populate)

  if (uncopied) {
    await safeAsync(() => Deno.remove(made, { recursive: true }))

    throw new CliError('Cannot populate a sandbox for the run', [
      uncopied.message,
      'The sandbox copies the sources and links the dependencies a suite reads',
    ])
  }

  return {
    root: made,
    path: join(made, source),
    [Symbol.asyncDispose]: async (): Promise<void> => {
      await safeAsync(() => Deno.remove(made, { recursive: true }))
    },
  }
}
