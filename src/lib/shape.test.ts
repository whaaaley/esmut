import { assert, assertEquals, assertExists } from '@std/assert'
import { describe, it } from 'node:test'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { shapeHash, shapeOf } from './shape.ts'
import { indexSource } from './walk.ts'

const nodeOf = (source: string, type: string): TSESTree.Node => {
  const [node] = indexSource(source, 'x.ts').byType.get(type) ?? []
  if (!node) throw new Error(`no ${type} in the source`)

  return node
}

describe('All Shape Tests', () => {
  describe('shapeHash', () => {
    // The whole reason the hash exists: a formatter rewrites lines, and the plan must not read that
    // as the code changing. The three below are what deno fmt actually does to one expression.
    it('holds across a line break the formatter inserts', () => {
      // Arrange
      const written = nodeOf('const a = kept > 0 && other < 3\n', 'LogicalExpression')
      const broken = nodeOf('const a = kept > 0 &&\n  other < 3\n', 'LogicalExpression')

      // Act & Assert
      assertEquals(shapeHash(written), shapeHash(broken))
    })

    it('holds across the quote style the formatter prefers', () => {
      // Arrange
      const double = nodeOf('const a = { b: "one" }\n', 'ObjectExpression')
      const single = nodeOf("const a = { b: 'one' }\n", 'ObjectExpression')

      // Act & Assert
      assertEquals(shapeHash(double), shapeHash(single))
    })

    it('holds across a trailing comma the formatter adds', () => {
      // Arrange
      const bare = nodeOf('const a = { b: 1, c: 2 }\n', 'ObjectExpression')
      const trailing = nodeOf('const a = {\n  b: 1,\n  c: 2,\n}\n', 'ObjectExpression')

      // Act & Assert
      assertEquals(shapeHash(bare), shapeHash(trailing))
    })

    // A hash that never changed would be useless, so these pin what it must notice.
    it('changes where an operator changes', () => {
      // Arrange
      const greater = nodeOf('const a = kept > 0\n', 'BinaryExpression')
      const orEqual = nodeOf('const a = kept >= 0\n', 'BinaryExpression')

      // Act & Assert
      assert(shapeHash(greater) !== shapeHash(orEqual), 'an operator change must show')
    })

    it('changes where a literal value changes', () => {
      // Arrange
      const three = nodeOf('const a = { b: 3 }\n', 'ObjectExpression')
      const four = nodeOf('const a = { b: 4 }\n', 'ObjectExpression')

      // Act & Assert
      assert(shapeHash(three) !== shapeHash(four), 'a value change must show')
    })

    it('changes where a name changes', () => {
      // Arrange
      const kept = nodeOf('const a = kept > 0\n', 'BinaryExpression')
      const other = nodeOf('const a = other > 0\n', 'BinaryExpression')

      // Act & Assert
      assert(shapeHash(kept) !== shapeHash(other), 'a binding change must show')
    })

    // Braces are structure rather than layout, which no formatter adds or removes on its own.
    it('changes where a body gains a block', () => {
      // Arrange
      const bare = nodeOf('const f = (a: number): void => {\n  if (a) go()\n}\n', 'IfStatement')
      const braced = nodeOf('const f = (a: number): void => {\n  if (a) { go() }\n}\n', 'IfStatement')

      // Act & Assert
      assert(shapeHash(bare) !== shapeHash(braced), 'a block is a structural change')
    })

    it('reads as eight hex characters, so a plan entry stays one line', () => {
      // Arrange
      const node = nodeOf('const a = 1\n', 'Literal')

      // Act
      const hash = shapeHash(node)

      // Assert
      assertEquals(hash.length, 8)
      assert(/^[0-9a-f]{8}$/.test(hash), `${hash} is not hex`)
    })
  })

  describe('shapeOf', () => {
    // raw carries the quote characters as typed, so reading it would undo the stability above.
    it('names the value of a literal and not the quotes around it', () => {
      // Arrange
      const node = nodeOf("const a = 'one'\n", 'Literal')

      // Act
      const shape = shapeOf(node)

      // Assert
      assertEquals(shape.includes('value=one'), true)
      assertEquals(shape.includes("'one'"), false)
    })

    it('names a child under the key that holds it, so two operands cannot be confused', () => {
      // Arrange
      const node = nodeOf('const a = kept > 0\n', 'BinaryExpression')

      // Act
      const shape = shapeOf(node)

      // Assert
      assert(shape.includes('left('), `${shape} names no left`)
      assert(shape.includes('right('), `${shape} names no right`)
    })

    it('carries no byte offset, which is what a reformat moves', () => {
      // Arrange
      const early = nodeOf('const a = 1\n', 'Literal')
      const late = nodeOf('\n\n\nconst a = 1\n', 'Literal')

      // Act & Assert
      assertExists(early)
      assertEquals(shapeOf(early), shapeOf(late))
    })
  })
})
