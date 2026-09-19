import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { type Indexed, indexSource, isNode, matchesUniquely } from './walk.ts'
import { known } from './keys.ts'
import { parseSelector } from './select.ts'
import type { Mutation, Op, Skipped } from './schema.ts'

export type Stubbed = {
  mutations: Mutation[]
  skipped: Skipped[]
}

// Anything a logger or an error carries is description rather than behavior, so it is not a site.
const MESSENGERS = new Set(['console', 'log', 'logger'])

// The ops and the selector attributes both read fields the node type does not declare.
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

const quote = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// Attributes that pin a node by its own content, cheapest and most readable first.
const attributes = (node: TSESTree.Node): string[] => {
  const found: string[] = []

  const value = field(node, 'value')
  const operator = field(node, 'operator')
  const name = field(node, 'name')

  if (typeof value === 'string' && value.length <= 40) found.push(`[value='${quote(value)}']`)
  if (typeof value === 'number' || typeof value === 'boolean') found.push(`[value=${String(value)}]`)
  if (typeof operator === 'string') found.push(`[operator='${quote(operator)}']`)
  if (typeof name === 'string') found.push(`[name='${quote(name)}']`)

  const callee = child(node, 'callee')
  const calleeName = named(callee)
  if (calleeName) found.push(`[callee.name='${quote(calleeName)}']`)

  const propertyName = named(child(callee, 'property'))
  if (propertyName) found.push(`[callee.property.name='${quote(propertyName)}']`)

  const keyName = named(child(node, 'key'))
  if (keyName) found.push(`[key.name='${quote(keyName)}']`)

  // A comparison is often told from its neighbour only by which binding it reads.
  const leftName = named(child(node, 'left'))
  if (leftName) found.push(`[left.name='${quote(leftName)}']`)

  const rightName = named(child(node, 'right'))
  if (rightName) found.push(`[right.name='${quote(rightName)}']`)

  return found
}

// A distinctive literal under a node, telling one ancestor from an identical sibling.
const baits = (indexed: Indexed, node: TSESTree.Node, depth: number): string[] => {
  if (depth > 3) return []

  const value = field(node, 'value')

  if (node.type === 'Literal' && typeof value === 'string' && value.length > 3 && value.length <= 40) {
    return [`:has(Literal[value='${quote(value)}'])`]
  }

  const found: string[] = []

  // The same keys the index walked with, so a bait never names a node the selector cannot reach.
  for (const key of known[node.type] ?? []) {
    const value = field(node, key)
    const children = Array.isArray(value) ? value : [value]

    for (const candidate of children) {
      if (!isNode(candidate)) continue

      found.push(...baits(indexed, candidate, depth + 1))
      if (found.length >= 3) return found.slice(0, 3)
    }
  }

  return found
}

const compounds = (node: TSESTree.Node): string[] => {
  const withAttribute = attributes(node).map((attribute) => node.type + attribute)
  return [node.type, ...withAttribute]
}

// Ancestors worth naming, nearest first: a recognizable scope beats a deep structural path.
const anchors = (indexed: Indexed, parents: TSESTree.Node[]): string[] => {
  const found: string[] = []

  for (const parent of parents) {
    const id = named(child(parent, 'id'))
    const key = named(child(parent, 'key'))

    if (id) found.push(`${parent.type}[id.name='${quote(id)}']`)
    else if (key) found.push(`${parent.type}[key.name='${quote(key)}']`)
    else found.push(parent.type)

    for (const bait of baits(indexed, parent, 0)) {
      found.push(`${parent.type}${bait}`)
    }
  }

  return found
}

// Candidates cheapest first, so the shortest selector that resolves to one node is the one kept.
export function* candidates(indexed: Indexed, node: TSESTree.Node): Generator<string> {
  const parents = indexed.ancestry.get(node) ?? []
  const selves = compounds(node)

  yield* selves

  const scopes = anchors(indexed, parents)

  for (const scope of scopes) {
    for (const self of selves) {
      yield `${scope} ${self}`
      yield `${scope} > ${self}`
    }
  }

  // Two levels of scope, which is what tells structurally identical siblings apart.
  // A selector reads outermost first, so the outer scope comes from further up the ancestry.
  // Both joiners are tried at both seams, since a twin is often separated by one child edge.
  for (let outer = scopes.length - 1; outer >= 0; outer--) {
    for (let inner = outer - 1; inner >= 0; inner--) {
      for (const self of selves) {
        yield `${scopes[outer]} ${scopes[inner]} ${self}`
        yield `${scopes[outer]} ${scopes[inner]} > ${self}`
        yield `${scopes[outer]} > ${scopes[inner]} ${self}`
        yield `${scopes[outer]} > ${scopes[inner]} > ${self}`
      }
    }
  }

  // The full ancestor chain, unique by construction as the node's address in the tree.
  // It comes before the combinatorial tiers because it cannot fail and never spends the budget.
  // The chain is drawn from the ancestry rather than from scopes, which baits every ancestor.
  const chain = [...parents].reverse().map((parent) => {
    const id = named(child(parent, 'id'))
    return id ? `${parent.type}[id.name='${quote(id)}']` : parent.type
  })

  for (const self of selves) {
    yield [...chain, self].join(' > ')
    yield [...chain, self].join(' ')
  }

  // Three levels, which is what a twin separated only by an intermediate child edge needs.
  for (let outer = scopes.length - 1; outer >= 0; outer--) {
    for (let mid = outer - 1; mid >= 0; mid--) {
      for (let inner = mid - 1; inner >= 0; inner--) {
        for (const self of selves) {
          yield `${scopes[outer]} ${scopes[mid]} > ${scopes[inner]} > ${self}`
          yield `${scopes[outer]} ${scopes[mid]} ${scopes[inner]} > ${self}`
          yield `${scopes[outer]} > ${scopes[mid]} > ${scopes[inner]} > ${self}`
        }
      }
    }
  }

  // Position is the last resort, since it drifts when a sibling is inserted before it.
  const position = indexed.index.get(node)

  if (typeof position === 'number') {
    for (const scope of scopes) {
      for (const self of selves) {
        yield `${scope} ${self}:nth-child(${position + 1})`
      }
    }
  }
}

// The first candidate naming this node alone, or null when the budget runs out without one.
export const address = (indexed: Indexed, node: TSESTree.Node, budget = 4000): string | null => {
  let tried = 0

  for (const candidate of candidates(indexed, node)) {
    if (tried >= budget) return null
    tried += 1

    const selector = parseSelector(candidate)
    if (matchesUniquely(indexed, selector, node)) return candidate
  }

  return null
}

// Locates every site and addresses what it can, leaving op, to, and name for the author.
export const stubPlan = (source: string, path: string): Stubbed => {
  const indexed = indexSource(source, path)

  const mutations: Mutation[] = []
  const skipped: Skipped[] = []

  for (const site of sites(indexed)) {
    const { node, ops } = site
    const was = source.slice(node.range[0], node.range[1])
    const at = address(indexed, node)

    if (at === null) {
      skipped.push({ was, line: node.loc.start.line, column: node.loc.start.column, ops })
      continue
    }

    mutations.push({ at, was, op: null })
  }

  return { mutations, skipped }
}
