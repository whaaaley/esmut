import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { known } from './keys.ts'
import { matchAll } from './query.ts'
import { parseSelector } from './select.ts'
import { type Indexed, isNode } from './walk.ts'

// A scalar reachable from a node by a chain of single-valued keys, which is what an attribute
// selector reads. Two levels covers the operand of a comparison and the property it reads.
const REACH = 2

// A string long enough to be worth quoting in a selector and short enough to stay readable.
const LONGEST = 40

const quote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

const scalar = (value: unknown): string | null => {
  if (typeof value === 'string') return value.length <= LONGEST ? `'${quote(value)}'` : null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  return null
}

// The keys carrying a scalar that the visitor list does not name, where an identifier's name and
// a literal's value live.
const SCALAR_KEYS: readonly string[] = ['name', 'value', 'operator']

const facts = (node: TSESTree.Node): string[] => {
  const found: string[] = []

  const gather = (current: TSESTree.Node, prefix: string, depth: number): void => {
    if (!isNode(current)) return

    // A visitor key names a child or a list of them, never a scalar, so the walk only descends.
    for (const key of known[current.type] ?? []) {
      const value = current[key]
      if (isNode(value) && depth < REACH) gather(value, `${prefix}${key}.`, depth + 1)
    }

    for (const key of SCALAR_KEYS) {
      const pinned = scalar(current[key])
      if (pinned) found.push(`[${prefix}${key}=${pinned}]`)
    }
  }

  gather(node, '', 0)

  return found
}

// The step naming where a node sits under its parent: a position when the key holds a list, and
// esquery's field selector when it does not, which is the only thing separating a ternary's sides.
const step = (indexed: Indexed, node: TSESTree.Node): string => {
  const position = indexed.index.get(node)
  if (typeof position === 'number') return `${node.type}:nth-child(${position + 1})`

  const field = indexed.field.get(node)

  return field ? `${node.type}.${field}` : node.type
}

// The node's path from the root as a child chain, which separates it from anything not on that path.
const path = (indexed: Indexed, node: TSESTree.Node): string[] => {
  const parents = indexed.ancestry.get(node) ?? []
  const steps = [node, ...parents].map((current) => step(indexed, current))

  return steps.reverse()
}

export type Pin = {
  at: string
  matches: number
}

// Counts how many of a node's own kind a selector names, which is the only question pin asks.
export type Counter = (at: string) => number

// One count per selector, since nodes of a kind try the same attributes as each other.
// A caller addressing a whole file asks the same selector once per twin without this.
export const counter = (indexed: Indexed): Counter => {
  const counted = new Map<string, number>()

  return (at: string): number => {
    const seen = counted.get(at)
    if (seen !== undefined) return seen

    const hits = matchAll(indexed.ast, parseSelector(at)).length
    // esmut-ignore the store changes no answer, only the match count
    counted.set(at, hits)

    return hits
  }
}

// Names a node by what separates it from its peers, computed rather than searched.
// Content comes first because an attribute is answered from the node itself, where a path makes
// esquery walk, so the cheapest selector that resolves is also the one a reader learns most from.
export const pin = (indexed: Indexed, node: TSESTree.Node, count: Counter): Pin => {
  for (const fact of facts(node)) {
    const at = `${node.type}${fact}`
    if (count(at) === 1) return { at, matches: 1 }
  }

  // Every step of the path is a list position or a single-valued key, so the chain from the root
  // names one node wherever the tree the index describes is the tree being asked.
  const chain = path(indexed, node).join(' > ')

  return { at: chain, matches: count(chain) }
}
