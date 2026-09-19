import { parse } from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import esquery from 'esquery'
import type { Selector } from 'esquery'
import { CliError } from '../utils/error.utils.ts'
import { safe } from '../utils/safe.utils.ts'
import { matchAll } from './query.ts'

export type Match = {
  // Byte offsets into the source, so an op can splice without re-finding the node.
  range: [number, number]
  line: number
  column: number
  type: string
  text: string
}

export const parseSource = (source: string, path: string): TSESTree.Node => {
  const { data, error } = safe(() => parse(source, { loc: true, range: true, jsx: path.endsWith('.tsx') }))

  if (error) {
    throw new CliError(`Cannot parse ${path}`, [
      error.message,
      'The file must be syntactically valid TypeScript or JavaScript',
    ])
  }

  return data
}

// A selector the parser refuses is a typo.
// Saying so beats a run reading it as a node that no longer exists.
// The ladder asks for the same candidate over and over, since its cheap tiers emit one shape per
// scope and a file holds many sites under the same few scopes.
// Parsing is pure, so the answer for a string never changes and is worth keeping.
const parsed = new Map<string, Selector>()

export const parseSelector = (selector: string): Selector => {
  const seen = parsed.get(selector)
  if (seen) return seen

  const { data, error } = safe(() => esquery.parse(selector))

  if (error) {
    throw new CliError(`Cannot parse the selector: ${selector}`, [
      error.message,
      'Selectors are ESQuery, the CSS-style language ESLint uses over ESTree',
    ])
  }

  parsed.set(selector, data)

  return data
}

// Resolves a selector to every node it matches.
// Count is the caller's to judge: nothing matched is stale and more than one is ambiguous.
export const select = (source: string, path: string, selector: string): Match[] => {
  const ast = parseSource(source, path)
  const query = parseSelector(selector)

  const nodes = matchAll(ast, query)

  // parseSource asks for loc and range, so the guard below cannot fire on a node from this file.
  // It stays because a Match promises positions, and a silent undefined corrupts an op's splice.
  return nodes.map((node) => {
    const { range, loc } = node

    if (!range || !loc) {
      throw new CliError(`A node matched in ${path} carries no position`, [
        'parseSource requests loc and range, so this is a bug in esmut rather than in the plan',
      ])
    }

    return {
      range: [range[0], range[1]],
      line: loc.start.line,
      column: loc.start.column,
      type: node.type,
      text: source.slice(range[0], range[1]),
    }
  })
}
