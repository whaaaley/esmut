import { parseArgs } from '@std/cli/parse-args'
import { extname } from '@std/path'
import { check } from './cmds/check.ts'
import { query } from './cmds/query.ts'
import { run } from './cmds/run.ts'
import { stub } from './cmds/stub.ts'
import { handleCliError } from './utils/cli.utils.ts'
import { CliError } from './utils/error.utils.ts'
import { safeAsync } from './utils/safe.utils.ts'

const args = parseArgs(Deno.args, {
  boolean: ['help', 'prune'],
  alias: { h: 'help' },
})

const printHelp = (): void => {
  const lines = [
    'Usage: esmut <command> [args]',
    '',
    'Mutation testing for TypeScript, addressed by ESQuery selector rather than by source text.',
    'A mutation the suite passes on is a behavior the tests run without checking.',
    '',
    'Commands:',
    '  query <file> <selector>  Print matches, with file:line:col and the source line',
    '  stub <file>              Emit a plan, addressing every site and deriving the op it can',
    '  check <file|dir>         Resolve selectors, report stale and ambiguous, run nothing',
    '  <file|dir>               Run the planned mutations',
    '',
    'Options:',
    '  --prune                  With check, drop the entries whose selector matches nothing',
    '  --help, -h               Show this help',
    '',
    'Mutations are planned in a json file under .esmut, each naming a node with a',
    'selector and an op to perform on it. Selectors are validated by match count: nothing',
    'matched is stale, more than one is ambiguous, and both are refused.',
    '',
    'Every mutant is type-checked before the suite runs, so one that does not compile is',
    'reported invalid rather than counted as a test catching the mutation.',
    '',
    'Progress goes to stderr and the summary to stdout. Exit code stays 0 whether or not',
    'a mutation survived.',
  ]

  console.log(lines.join('\n'))
}

const SOURCES = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

// A bare path is the run verb, so an unknown word has to be told apart from a file.
// Anything carrying a path separator or a source extension reads as a target.
export const isTarget = (verb: string): boolean => verb.includes('/') || SOURCES.has(extname(verb))

export type Flags = {
  prune?: boolean
}

export const dispatch = (verb: string | undefined, rest: string[], flags: Flags = {}): Promise<void> => {
  if (verb === undefined) {
    throw new CliError('Missing command', [
      'Name a file or directory to run, or a command',
      'Run with --help for usage',
    ])
  }

  // check is the only verb that prunes, so the flag on any other is a typo rather than a request.
  if (flags.prune && verb !== 'check') {
    throw new CliError('--prune applies to check', [
      'Usage: esmut check <file|dir> --prune',
    ])
  }

  if (verb === 'query') {
    const [file, selector] = rest
    if (!file) {
      throw new CliError('query requires a file', [
        'Usage: esmut query <file> "<selector>"',
      ])
    }
    if (!selector) {
      throw new CliError('query requires a selector', [
        'Usage: esmut query <file> "<selector>"',
        'Quote the selector so the shell keeps it whole',
      ])
    }

    return query(file, selector)
  }

  if (verb === 'stub') {
    const [file] = rest
    if (!file) {
      throw new CliError('stub requires a file', [
        'Usage: esmut stub <file>',
      ])
    }

    return stub(file)
  }

  if (verb === 'check') {
    const [target] = rest
    if (!target) {
      throw new CliError('check requires a file or directory', [
        'Usage: esmut check <file|dir>',
      ])
    }

    return check(target, { prune: flags.prune })
  }

  if (isTarget(verb)) return run(verb)

  throw new CliError(`Unknown command: "${verb}"`, [
    'Valid commands: query, stub, check',
    'Name a file or directory to run its plan',
    'Run with --help for usage',
  ])
}

// Guarded so a test can import dispatch and isTarget without the module running the CLI.
if (import.meta.main) {
  if (args.help) {
    printHelp()
    Deno.exit(0)
  }

  const [verb, ...rest] = args._.map(String)

  const { error } = await safeAsync(() => dispatch(verb, rest, { prune: args.prune }))
  if (error) handleCliError(error)

  Deno.exit(0)
}
