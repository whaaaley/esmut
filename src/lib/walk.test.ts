import { assert, assertEquals } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import { AST_NODE_TYPES } from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { parseSelector } from './select.ts'
import { indexSource, isNode, matchesUniquely } from './walk.ts'

const FIXTURES = fromFileUrl(new URL('../../tests/fixtures/', import.meta.url))

const read = (name: string): { path: string; source: string } => {
  const path = `${FIXTURES}${name}`
  return { path, source: Deno.readTextFileSync(path) }
}

describe('All Walk Tests', () => {
  describe('indexSource', () => {
    // estraverse names no children for TS-only kinds, so its keys stop a walk at the enum.
    // The member values below it go missing from byType, and a selector naming one reads as stale.
    it('reaches a node standing under TS-only kinds, which carry no children in the default keys', () => {
      // Arrange
      const { path, source } = read('04-typescript-kinds.ts')

      // Act: the enum values sit under TSEnumMember, which no ordinary expression path reaches.
      const indexed = indexSource(source, path)
      const literals = indexed.byType.get('Literal') ?? []

      const enumerated = literals.filter((literal) => (
        (indexed.ancestry.get(literal) ?? []).some((parent) => parent.type === AST_NODE_TYPES.TSEnumMember)
      ))

      // Assert
      assertEquals(enumerated.map((literal) => source.slice(literal.range[0], literal.range[1])), ['1', '2'])

      const [first] = enumerated
      const parents = (first ? indexed.ancestry.get(first) ?? [] : []).map((parent) => parent.type)

      assert(parents.includes(AST_NODE_TYPES.TSEnumDeclaration), 'the declaration is missing from the chain')
    })

    // The address builder reads index to decide on an nth-child, and position zero is falsy.
    // A first element recorded as null rather than 0 reads as single-valued and picks wrongly.
    it('records a list element position and a single-valued key having none', () => {
      // Arrange
      const source = 'export const codes = [404, 410]\nexport const only = 500\n'

      // Act
      const indexed = indexSource(source, 'codes.ts')
      const literals = indexed.byType.get('Literal') ?? []
      const [first, second, lone] = literals

      // Assert: the walk appends in source order, which naming the three by position relies on.
      assertEquals(literals.map((literal) => source.slice(literal.range[0], literal.range[1])), ['404', '410', '500'])

      // A list records where each element sat, and a single-valued key records that there was none.
      assertEquals(first && indexed.index.get(first), 0)
      assertEquals(second && indexed.index.get(second), 1)
      assertEquals(lone && indexed.index.get(lone), null)
    })

    // field names the key on the parent holding a node, which is how an address says where it sits.
    it('names the key on the parent that holds each node', () => {
      // Arrange
      const source = 'export const go = (a: number): number => a + 1\n'

      // Act
      const indexed = indexSource(source, 'go.ts')
      const [binary] = indexed.byType.get('BinaryExpression') ?? []
      const [declarator] = indexed.byType.get('VariableDeclarator') ?? []

      // Assert
      assertEquals(binary && indexed.field.get(binary), 'body')
      assertEquals(declarator && indexed.field.get(declarator), 'declarations')
    })

    // Every node of a type lands in its group in the order the walk reached them, parents first.
    // The group was rebuilt by copying on each arrival, so this pins the contents the copying produced.
    it('groups every node of a type in source order', () => {
      // Arrange
      const source = "const a = 'one'\nconst b = 'two'\nconst c = 'three'\n"

      // Act
      const indexed = indexSource(source, 'order.ts')
      const literals = indexed.byType.get('Literal') ?? []

      // Assert
      assertEquals(literals.map((literal) => source.slice(literal.range[0], literal.range[1])), ["'one'", "'two'", "'three'"])
    })
  })

  describe('isNode', () => {
    // typeof null is object, so a null reaching the walk indexes as a node and throws on its type.
    it('refuses null and a plain object, which carry no node type', () => {
      // Act & Assert
      assertEquals(isNode(null), false)
      assertEquals(isNode({}), false)
      assertEquals(isNode({ type: 1 }), false)
      assertEquals(isNode('Literal'), false)
      assertEquals(isNode({ type: 'Literal' }), true)
    })

    // Array.isArray sorts a list key out before the guard runs, so the guard reads type alone.
    it('admits an array carrying a string type and refuses a bare one', () => {
      // Arrange
      const typed = Object.assign([], { type: 'Literal' })

      // Act & Assert
      assertEquals(isNode([]), false)
      assertEquals(isNode(typed), true)
    })
  })

  describe('matchesUniquely', () => {
    const indexOf = (source: string): ReturnType<typeof indexSource> => indexSource(source, 'x.ts')

    const nodeAt = (indexed: ReturnType<typeof indexSource>, type: string, position: number): TSESTree.Node => {
      const found = (indexed.byType.get(type) ?? [])[position]
      if (!found) throw new Error(`No ${type} at ${position}`)

      return found
    }

    // A selector naming this node and nothing else is the one a plan can carry.
    it('holds for a selector naming this node alone', () => {
      // Arrange
      const indexed = indexOf("const only = 'here'\n")
      const node = nodeAt(indexed, 'Literal', 0)

      // Act & Assert
      assertEquals(matchesUniquely(indexed, parseSelector("Literal[value='here']"), node), true)
    })

    // A selector matching this node and a sibling is ambiguous, and applying it mutates blindly.
    it('fails where the selector also names a peer', () => {
      // Arrange
      const indexed = indexOf("const a = 'x'\nconst b = 'x'\n")
      const node = nodeAt(indexed, 'Literal', 0)

      // Act & Assert
      assertEquals(matchesUniquely(indexed, parseSelector('Literal'), node), false)
    })

    // A selector matching a different node is stale for this one, whatever it matches elsewhere.
    it('fails where the selector names some other node', () => {
      // Arrange
      const indexed = indexOf("const a = 'x'\nconst b = 'y'\n")
      const node = nodeAt(indexed, 'Literal', 0)

      // Act & Assert
      assertEquals(matchesUniquely(indexed, parseSelector("Literal[value='y']"), node), false)
    })

    // Only nodes sharing a type are compared, so one matching two kinds escapes the peer check.
    it('compares against the peers of this node type', () => {
      // Arrange
      const indexed = indexOf("const a = 'x'\nconst b = 'x'\nconst c = 1\n")
      const first = nodeAt(indexed, 'Literal', 0)

      // Act & Assert: three literals share a type, and two of them share the value.
      assertEquals((indexed.byType.get('Literal') ?? []).length, 3)
      assertEquals(matchesUniquely(indexed, parseSelector("Literal[value='x']"), first), false)
      assertEquals(matchesUniquely(indexed, parseSelector('Literal[value=1]'), nodeAt(indexed, 'Literal', 2)), true)
    })
  })
})
