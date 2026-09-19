import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { type Indexed, indexSource, isNode } from './walk.ts'
import { pin } from './pin.ts'
import { matchAll } from './query.ts'
import { parseSelector } from './select.ts'
import type { Mutation, Op } from './schema.ts'

export type Stubbed = {
  mutations: Mutation[]
}

// Anything a logger or an error carries is description rather than behavior, so it is not a site.
const MESSENGERS = new Set(['console', 'log', 'logger'])

// The ops read fields the node type does not declare.
const field = (node: TSESTree.Node | undefined, key: string): unknown => (
  isNode(node) ? node[key] : undefined
)

// A field holding a child node, which is what an attribute selector walks into.
const child = (node: TSESTree.Node | undefined, key: string): TSESTree.Node | undefined => {
  const value = field(node, key)
  return isNode(value) ? value : undefined
}

// A field holding a list with something in it.
const holds = (node: TSESTree.Node | undefined, key: string): boolean => {
  const value = field(node, key)
  return Array.isArray(value) && value.length > 0
}

const named = (node: TSESTree.Node | undefined): string | null => {
  if (!node) return null

  const name = field(node, 'name')
  return typeof name === 'string' ? name : null
}

const describes = (parents: TSESTree.Node[]): boolean =>
  parents.some((parent) => {
    if (parent.type === 'CallExpression') {
      const owner = named(child(child(parent, 'callee'), 'object'))

      if (owner && MESSENGERS.has(owner)) return true
    }

    if (parent.type === 'NewExpression') {
      const name = named(child(parent, 'callee'))

      if (name?.endsWith('Error')) return true
    }

    return false
  })

// Which of the seven ops a node can legally take, empty when it is not a site.
export const opsFor = (node: TSESTree.Node, parent: TSESTree.Node | undefined): Op[] => {
  if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') return ['invert']
  if (node.type === 'LogicalExpression') return ['drop-left', 'drop-right', 'invert']
  if (node.type === 'BinaryExpression') return ['operator', 'invert']
  if (node.type === 'UnaryExpression' && field(node, 'operator') === '!') return ['invert']

  if (node.type === 'Literal') {
    // A module specifier tests the resolver, and a property key is a rename the compiler refuses.
    if (parent?.type === 'ImportDeclaration' || parent?.type === 'ExportNamedDeclaration') return []
    if (parent?.type === 'Property' && child(parent, 'key') === node) return []

    const value = field(node, 'value')
    const empties = typeof value === 'string' && value !== '' ? ['empty' as const] : []
    return ['value', ...empties]
  }

  if (node.type === 'TemplateLiteral') return ['empty']

  // An already-empty literal is the empty form, so emptying it is a mutant equal to the original.
  if (node.type === 'ArrayExpression') return holds(node, 'elements') ? ['empty'] : []
  if (node.type === 'ObjectExpression') return holds(node, 'properties') ? ['empty'] : []

  if (node.type === 'ReturnStatement') return field(node, 'argument') ? ['remove'] : []
  if (node.type === 'ThrowStatement') return ['remove']
  if (node.type === 'ExpressionStatement') return ['remove']
  if (node.type === 'Property') return ['remove']

  return []
}

export type Site = {
  node: TSESTree.Node
  ops: Op[]
}

export const sites = (indexed: Indexed): Site[] => {
  const found: Site[] = []

  for (const nodes of indexed.byType.values()) {
    for (const node of nodes) {
      const parents = indexed.ancestry.get(node) ?? []
      if (describes(parents)) continue

      const ops = opsFor(node, parents[0])
      if (ops.length > 0) found.push({ node, ops })
    }
  }

  return found.sort((left, right) => left.node.range[0] - right.node.range[0])
}

// Locates every site and addresses it, leaving op, to, and name for the author.
// A node's path names it whatever its content, so every site gets an address and none is left out.
export const stubPlan = (source: string, path: string): Stubbed => {
  const indexed = indexSource(source, path)

  const mutations: Mutation[] = []

  // One count per selector, since sites of a type ask about the same shapes as each other.
  const counted = new Map<string, number>()

  const count = (at: string): number => {
    const seen = counted.get(at)
    if (seen !== undefined) return seen

    const hits = matchAll(indexed.ast, parseSelector(at)).length
    counted.set(at, hits)

    return hits
  }

  for (const site of sites(indexed)) {
    const { node } = site
    const was = source.slice(node.range[0], node.range[1])
    const { at } = pin(indexed, node, count)

    mutations.push({ at, was, op: null })
  }

  return { mutations }
}
