import type { TSESTree } from '@typescript-eslint/typescript-estree'
import type { Selector } from 'esquery'
import { ignored } from './ignore.ts'
import { known } from './keys.ts'
import { matchesNode } from './query.ts'
import { parseSource } from './select.ts'

// A node read by visitor key rather than by field name, so a walk indexes it without asserting.
export type KeyedNode = TSESTree.Node & { readonly [key: string]: unknown }

export type Indexed = {
  ast: TSESTree.Node
  // Every node of a type, so a candidate is checked against its own kind, not the whole tree.
  byType: Map<string, TSESTree.Node[]>
  // Parents nearest-last, which is the shape esquery.matches wants.
  ancestry: Map<TSESTree.Node, TSESTree.Node[]>
  // The key on the parent holding this node, and the position when that key holds a list.
  field: Map<TSESTree.Node, string>
  index: Map<TSESTree.Node, number | null>
  // Whether a selector matched a node, keyed by the parsed selector and then by the node.
  // The ladder offers the same selector to a node and its peers across tiers, and a :has() bait
  // costs esquery a walk of the subtree every time, so the repeats are what a stub waits on.
  answered: Map<Selector, Map<TSESTree.Node, boolean>>
  // The lines an author excused with a marker, and the reason each one gives.
  excused: Map<number, string>
}

export const isNode = (value: unknown): value is KeyedNode => {
  if (typeof value !== 'object' || value === null) return false
  return 'type' in value && typeof value.type === 'string'
}

// Walks once and records what a selector search needs, since walking per candidate is slow.
export const indexSource = (source: string, path: string): Indexed => {
  const ast = parseSource(source, path)

  const byType = new Map<string, TSESTree.Node[]>()
  const ancestry = new Map<TSESTree.Node, TSESTree.Node[]>()
  const field = new Map<TSESTree.Node, string>()
  const index = new Map<TSESTree.Node, number | null>()
  const answered = new Map<Selector, Map<TSESTree.Node, boolean>>()

  const walk = (node: KeyedNode, parents: TSESTree.Node[]): void => {
    const peers = byType.get(node.type)

    if (peers) peers.push(node)
    else byType.set(node.type, [node])

    ancestry.set(node, parents)

    const parented = [node, ...parents]

    // The same keys esquery matches with, so no node the selector cannot reach is offered.
    for (const key of known[node.type] ?? []) {
      const value = node[key]

      if (Array.isArray(value)) {
        value.forEach((child, position) => {
          if (!isNode(child)) return

          field.set(child, key)
          index.set(child, position)
          walk(child, parented)
        })

        continue
      }

      if (!isNode(value)) continue

      field.set(value, key)
      index.set(value, null)
      walk(value, parented)
    }
  }

  // The root arrives typed as a plain node, and the same guard that admits a child admits it.
  if (isNode(ast)) walk(ast, [])

  return { ast, byType, ancestry, field, index, answered, excused: ignored(ast.comments ?? []) }
}

// True when the selector matches this node and nothing else.
// Only nodes of the same type are checked, which holds while a rightmost compound names one type.
export const matchesUniquely = (indexed: Indexed, selector: Selector, node: TSESTree.Node): boolean => {
  const peers = indexed.byType.get(node.type) ?? []

  let answers = indexed.answered.get(selector)

  if (!answers) {
    answers = new Map<TSESTree.Node, boolean>()
    indexed.answered.set(selector, answers)
  }

  // The tree an Indexed describes never changes, so an answer already given still holds.
  const matches = (candidate: TSESTree.Node): boolean => {
    const answered = answers.get(candidate)
    if (answered !== undefined) return answered

    const matched = matchesNode(candidate, selector, indexed.ancestry.get(candidate) ?? [])
    answers.set(candidate, matched)

    return matched
  }

  if (!matches(node)) return false

  return !peers.some((peer) => peer !== node && matches(peer))
}
