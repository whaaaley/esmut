import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { CliError } from '../utils/error.utils.ts'
import type { Mutation } from './schema.ts'
import { isNode } from './walk.ts'

type Edit = {
  at: TSESTree.Node
  text: string
}

// A mutant reading the same as the source ran nothing, and a suite passing on it says survived.
// That verdict is indistinguishable from a real finding, so a no-op is refused instead.
export class NoOpError extends CliError {}

const field = (node: TSESTree.Node, key: string): unknown => isNode(node) ? node[key] : undefined

const child = (node: TSESTree.Node, key: string): TSESTree.Node | undefined => {
  const value = field(node, key)
  return isNode(value) ? value : undefined
}

const slice = (source: string, node: TSESTree.Node): string => source.slice(node.range[0], node.range[1])

// A branch is inverted at its condition, since negating the statement is not an expression.
const condition = (node: TSESTree.Node): TSESTree.Node | undefined => {
  if (node.type === 'IfStatement' || node.type === 'ConditionalExpression') return child(node, 'test')
  return node
}

// Removing a negation reads the operand rather than wrapping, since !(!a) is the original.
const invert = (source: string, node: TSESTree.Node): Edit => {
  const target = condition(node)

  if (!target) {
    throw new CliError(`A ${node.type} carries no condition to invert`, [
      'invert applies to a guard or a boolean expression',
    ])
  }

  const negated = target.type === 'UnaryExpression' && field(target, 'operator') === '!'
  const argument = child(target, 'argument')

  if (negated && argument) return { at: target, text: slice(source, argument) }

  // Negation binds tighter than comparison, so !a === b parses as (!a) === b.
  // Wrapping keeps the mutation the one the plan names.
  return { at: target, text: `!(${slice(source, target)})` }
}

const operand = (source: string, node: TSESTree.Node, key: string): string => {
  const side = child(node, key)
  const other = child(node, key === 'left' ? 'right' : 'left')

  if (!side || !other) {
    throw new CliError(`A ${node.type} carries no ${key} to keep`, [
      'drop-left and drop-right apply to && and ||',
    ])
  }

  // Dropping either side of a && a leaves a, which reads as a mutation while testing nothing.
  // The source still differs as text, so only comparing the operands catches it.
  if (slice(source, side).trim() === slice(source, other).trim()) {
    throw new NoOpError(`Both sides of the ${node.type} read the same`, [
      `Dropping either leaves ${slice(source, side).trim()}, so a suite passing on it would report survived`,
    ])
  }

  return slice(source, side)
}

// A number has no empty form, so emptying one asks for '' where a number belongs.
// Refusing here names the plan as wrong rather than letting the type gate report invalid.
const emptied = (node: TSESTree.Node): string => {
  if (node.type === 'Literal') {
    if (typeof field(node, 'value') === 'string') return "''"

    throw new CliError(`empty does not apply to a ${node.type} holding ${typeof field(node, 'value')}`, [
      'empty applies to an array, an object, or a string literal',
    ])
  }

  const forms: Record<string, string> = {
    ArrayExpression: '[]',
    ObjectExpression: '{}',
    TemplateLiteral: '``',
  }

  const form = forms[node.type]

  if (!form) {
    throw new CliError(`empty does not apply to a ${node.type}`, [
      'empty applies to an array, an object, or a string literal',
    ])
  }

  return form
}

// Produces the text replacing a node and which node it replaces.
// invert edits the condition, so the node edited is not always the node addressed.
const replacement = (source: string, node: TSESTree.Node, mutation: Mutation): Edit => {
  const { op, to } = mutation

  if (op === 'invert') return invert(source, node)
  if (op === 'drop-left') return { at: node, text: operand(source, node, 'right') }
  if (op === 'drop-right') return { at: node, text: operand(source, node, 'left') }
  if (op === 'empty') return { at: node, text: emptied(node) }
  if (op === 'remove') return { at: node, text: '' }

  if (op === 'operator' || op === 'value') {
    if (to === undefined) {
      throw new CliError(`${op} needs a replacement`, [
        `The mutation at ${mutation.at} names no to`,
      ])
    }

    if (op === 'value') return { at: node, text: to }

    const original = field(node, 'operator')
    const left = child(node, 'left')
    const right = child(node, 'right')

    if (typeof original !== 'string' || !left || !right) {
      throw new CliError(`operator does not apply to a ${node.type}`, [
        'operator applies to a binary or logical expression',
      ])
    }

    // The operator is spliced between the operands rather than found by text.
    // Its characters also occur in a literal, which a text match would corrupt instead.
    const between = source.slice(left.range[1], right.range[0])
    const swapped = between.replace(original, to)

    return { at: node, text: slice(source, left) + swapped + slice(source, right) }
  }

  throw new CliError(`Unknown op: ${String(op)}`, [
    'The ops are invert, drop-left, drop-right, operator, value, empty, and remove',
  ])
}

// Applies one mutation, refusing a replacement that reads the same as what it replaces.
// The whole source is compared, since dropping an operand from a && a reads as a.
export const applyOp = (source: string, node: TSESTree.Node, mutation: Mutation): string => {
  const { at, text } = replacement(source, node, mutation)
  const was = slice(source, at)
  const mutated = source.slice(0, at.range[0]) + text + source.slice(at.range[1])

  if (mutated.trim() === source.trim()) {
    throw new NoOpError(`The ${mutation.op} at ${mutation.at} leaves the source unchanged`, [
      `It reads ${was.trim()} either way, so a suite passing on it would report survived`,
      'Name a different site, or an op that changes this one',
    ])
  }

  return mutated
}
