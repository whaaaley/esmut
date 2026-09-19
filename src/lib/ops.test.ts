import { assertEquals, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from 'node:test'
import { CliError } from '../utils/error.utils.ts'
import { applyOp, NoOpError } from './ops.ts'
import type { Mutation, Op } from './schema.ts'
import { indexSource } from './walk.ts'

// Applies one op to the first node of a type, how a plan names a site in a one-expression source.
// A null op is the unfilled state a stub writes, reaching the refusal an op outside the seven does.
const mutate = (source: string, type: string, op: Op | null, to?: string): string => {
  const indexed = indexSource(source, 'x.ts')
  const [node] = indexed.byType.get(type) ?? []

  if (!node) throw new Error(`No ${type} in the source`)

  const mutation: Mutation = { at: type, shape: '00000000', op, ...(to === undefined ? {} : { to }) }

  return applyOp(source, node, mutation).trim()
}

// A refusal is what the author reads to fix the plan, so a test reads its message and suggestions.
const refusal = (source: string, type: string, op: Op | null, to?: string): CliError => {
  return assertThrows(() => mutate(source, type, op, to), CliError)
}

describe('All Ops Tests', () => {
  describe('invert', () => {
    // A guard is negated at the condition it reads: a statement is not an expression to negate.
    // Wrapping the branch emits !(if (ready) go()), which never parses and reports invalid.
    it('negates the condition a branch reads rather than the branch itself', () => {
      // Act & Assert
      assertEquals(mutate('if (ready) go()\n', 'IfStatement', 'invert'), 'if (!(ready)) go()')
      assertEquals(mutate('const x = a ? b : c\n', 'ConditionalExpression', 'invert'), 'const x = !(a) ? b : c')
    })

    // Wrapping an already-negated condition yields !(!a), which reads the same as the original.
    // A suite passing on that reports survived, a finding the author cannot tell from a real one.
    it('reads the operand of a negated condition rather than negating it twice', () => {
      // Act & Assert
      assertEquals(mutate('if (!ready) go()\n', 'IfStatement', 'invert'), 'if (ready) go()')
    })

    // Negation binds tighter than comparison, so !a === b parses as (!a) === b.
    it('parenthesises what it negates, since negation binds tighter than comparison', () => {
      // Act & Assert
      assertEquals(mutate('const c = a === b\n', 'BinaryExpression', 'invert'), 'const c = !(a === b)')
    })
  })

  describe('drop-left and drop-right', () => {
    it('keeps the side its name does not drop', () => {
      // Act & Assert
      assertEquals(mutate('const c = a && b\n', 'LogicalExpression', 'drop-left'), 'const c = b')
      assertEquals(mutate('const c = a && b\n', 'LogicalExpression', 'drop-right'), 'const c = a')
    })

    // Dropping either side of a && a leaves a, which changes nothing and would report survived.
    it('refuses a drop leaving the source as it was', () => {
      // Act & Assert
      assertThrows(() => mutate('const c = a && a\n', 'LogicalExpression', 'drop-left'), NoOpError)
    })

    // The refusal quotes what the drop would leave, telling the author the site is the wrong one.
    it('quotes the operand a refused drop would have left', () => {
      // Arrange
      const sameSides = refusal('const c = a && a\n', 'LogicalExpression', 'drop-left')

      // Assert
      assertStringIncludes(sameSides.message, 'Both sides of the LogicalExpression read the same')
      assertEquals(sameSides.suggestions, ['Dropping either leaves a, so a suite passing on it would report survived'])
    })

    // A node with no left or right cannot keep a side, and the refusal names the key asked for.
    it('names the side it cannot keep and the ops that apply', () => {
      // Arrange
      const noSides = refusal('const c = a && b\n', 'VariableDeclarator', 'drop-left')

      // Assert
      assertStringIncludes(noSides.message, 'A VariableDeclarator carries no right to keep')
      assertEquals(noSides.suggestions, ['drop-left and drop-right apply to && and ||'])
    })
  })

  describe('operator', () => {
    it('swaps the operator between the operands', () => {
      // Act & Assert
      assertEquals(mutate('const c = a === b\n', 'BinaryExpression', 'operator', '!=='), 'const c = a !== b')
      assertEquals(mutate('const c = a && b\n', 'LogicalExpression', 'operator', '||'), 'const c = a || b')
    })

    // Matching the operator by text finds it in a literal first, corrupting that and leaving it.
    // The result still compiles, so the gate passes a mutation that is not the one the plan names.
    it('reads the operator by position, so a literal holding the same characters survives', () => {
      // Act & Assert
      assertEquals(mutate("const r = '+' + x\n", 'BinaryExpression', 'operator', '-'), "const r = '+' - x")
    })

    it('refuses a swap to the operator already there', () => {
      // Act & Assert
      assertThrows(() => mutate('const c = a === b\n', 'BinaryExpression', 'operator', '==='), NoOpError)
    })

    // A node with no operator between two operands cannot take the op, and the refusal names one.
    it('names the node kind and the expressions operator applies to', () => {
      // Arrange
      const notBinary = refusal('const s = 400\n', 'Literal', 'operator', '+')

      // Assert
      assertStringIncludes(notBinary.message, 'operator does not apply to a Literal')
      assertEquals(notBinary.suggestions, ['operator applies to a binary or logical expression'])
    })

    // The swap is spliced between the operands, keeping the whitespace either side of the operator.
    it('keeps the spacing around the operator it swaps', () => {
      // Act & Assert
      assertEquals(mutate('const c = a  ===  b\n', 'BinaryExpression', 'operator', '!=='), 'const c = a  !==  b')
    })
  })

  describe('value', () => {
    it('replaces the literal with the one named', () => {
      // Act & Assert
      assertEquals(mutate('const s = 400\n', 'Literal', 'value', '200'), 'const s = 200')
    })

    it('refuses a replacement reading the same as the literal', () => {
      // Act & Assert
      assertThrows(() => mutate('const s = 400\n', 'Literal', 'value', '400'), NoOpError)
    })

    it('refuses a value naming no replacement', () => {
      // Act & Assert
      assertThrows(() => mutate('const s = 400\n', 'Literal', 'value'), CliError)
    })

    // The refusal quotes the selector, so an author fixing a long plan knows which entry to edit.
    it('names the op and the selector of the mutation naming no replacement', () => {
      // Arrange
      const noTo = refusal('const s = 400\n', 'Literal', 'value')

      // Assert
      assertStringIncludes(noTo.message, 'value needs a replacement')
      assertEquals(noTo.suggestions, ['The mutation at Literal names no to'])
    })

    // operator and value are the two ops carrying a replacement, so both reach the same refusal.
    it('names operator as the op when an operator mutation carries no replacement', () => {
      // Arrange
      const noTo = refusal('const c = a === b\n', 'BinaryExpression', 'operator')

      // Assert
      assertStringIncludes(noTo.message, 'operator needs a replacement')
    })
  })

  describe('empty', () => {
    // Each kind has its own empty form, and a template emptied to a quoted string changes kind.
    it('replaces each kind with the empty form of its own kind', () => {
      // Act & Assert
      assertEquals(mutate('const a = [1, 2]\n', 'ArrayExpression', 'empty'), 'const a = []')
      assertEquals(mutate('const o = { a: 1 }\n', 'ObjectExpression', 'empty'), 'const o = {}')
      assertEquals(mutate("const s = 'hi'\n", 'Literal', 'empty'), "const s = ''")
      assertEquals(mutate('const t = `hi ${name}`\n', 'TemplateLiteral', 'empty'), 'const t = ``')
    })

    // A number has no empty form, so emptying one asks for '' where a number belongs.
    // Refusing names the plan as wrong rather than reporting invalid, which means non-compiling.
    it('refuses a number, which carries no empty form', () => {
      // Act & Assert
      assertThrows(() => mutate('const n = 400\n', 'Literal', 'empty'), CliError)
    })

    it('refuses a collection already empty, since emptying it changes nothing', () => {
      // Act & Assert
      assertThrows(() => mutate('const a = []\n', 'ArrayExpression', 'empty'), NoOpError)
    })

    // The refusal names what the literal holds, where Literal alone never says why it was refused.
    it('names the type the refused literal holds and the kinds empty applies to', () => {
      // Arrange
      const number = refusal('const n = 400\n', 'Literal', 'empty')

      // Assert
      assertStringIncludes(number.message, 'empty does not apply to a Literal holding number')
      assertEquals(number.suggestions, ['empty applies to an array, an object, or a string literal'])
    })

    // A boolean reaches the refusal a number does, the branch reading the held type not the node.
    it('names boolean as the type a refused boolean literal holds', () => {
      // Arrange
      const boolean = refusal('const b = true\n', 'Literal', 'empty')

      // Assert
      assertStringIncludes(boolean.message, 'holding boolean')
    })

    // A node that is neither a literal nor a collection carries no empty form at all.
    it('names the node kind and the kinds empty applies to when the kind has no empty form', () => {
      // Arrange
      const identifier = refusal('const c = a && b\n', 'Identifier', 'empty')

      // Assert
      assertStringIncludes(identifier.message, 'empty does not apply to a Identifier')
      assertEquals(identifier.suggestions, ['empty applies to an array, an object, or a string literal'])
    })
  })

  describe('remove', () => {
    it('takes the node out of the source', () => {
      // Act & Assert
      assertEquals(mutate('const a = 1\nconsole.log(a)\n', 'ExpressionStatement', 'remove'), 'const a = 1')
    })

    // Leaving whitespace where the node was still compiles, so the text removed is empty not blank.
    it('leaves nothing where the node was rather than a blank in its place', () => {
      // Act & Assert
      assertEquals(mutate('const a = [go()]\n', 'CallExpression', 'remove'), 'const a = []')
    })
  })

  describe('refusals every op shares', () => {
    // A stub leaves op null until an author picks one, and applying that names the seven.
    it('names the unfilled op and lists the seven that exist', () => {
      // Arrange
      const unfilled = refusal('const s = 400\n', 'Literal', null)

      // Assert
      assertStringIncludes(unfilled.message, 'Unknown op: null')
      assertEquals(unfilled.suggestions, ['The ops are invert, drop-left, drop-right, operator, value, empty, and remove'])
    })

    // A mutant reading as the source reports survived while testing nothing, so it is refused.
    it('names the op, the selector, and what the site reads either way', () => {
      // Arrange
      const noOp = refusal('const s = 400\n', 'Literal', 'value', '400')

      // Assert
      assertStringIncludes(noOp.message, 'The value at Literal leaves the source unchanged')
      assertEquals(noOp.suggestions, [
        'It reads 400 either way, so a suite passing on it would report survived',
        'Name a different site, or an op that changes this one',
      ])
    })
  })
})
