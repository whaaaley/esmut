import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { known } from './keys.ts'
import { isNode } from './walk.ts'

// The scalars that carry meaning rather than layout.
// raw is left out although it sits beside value, because it keeps the quote characters as typed,
// so reading it would make a formatter rewriting "a" to 'a' read as a change to the code.
const MEANING: readonly string[] = ['name', 'value', 'operator', 'kind']

// A node's structure as text, walking the visitor keys so nothing positional is read.
// Whitespace, line breaks, and semicolons are absent because the parser never put them in the tree,
// which is what makes two spellings of one expression agree here.
export const shapeOf = (node: TSESTree.Node): string => {
  const parts: string[] = [node.type]

  for (const key of known[node.type] ?? []) {
    const value = isNode(node) ? node[key] : undefined

    if (Array.isArray(value)) {
      parts.push(`${key}[${value.filter(isNode).map(shapeOf).join(',')}]`)
      continue
    }

    if (isNode(value)) parts.push(`${key}(${shapeOf(value)})`)
  }

  for (const key of MEANING) {
    const value = isNode(node) ? node[key] : undefined
    if (value !== undefined && typeof value !== 'object') parts.push(`${key}=${String(value)}`)
  }

  return parts.join(' ')
}

const OFFSET = 2166136261
const PRIME = 16777619

// FNV-1a over the shape, which is synchronous where crypto.subtle is not.
// A stub hashes every site, and awaiting a digest per site measured five times this whole walk.
// A collision costs one drift warning nobody sees, so cryptographic width buys nothing here.
export const shapeHash = (node: TSESTree.Node): string => {
  const shape = shapeOf(node)
  let hash = OFFSET

  for (let index = 0; index < shape.length; index++) {
    hash ^= shape.charCodeAt(index)
    hash = Math.imul(hash, PRIME)
  }

  return (hash >>> 0).toString(16).padStart(8, '0')
}
