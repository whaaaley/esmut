import { assert, assertEquals, assertThrows } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import { CliError } from '../utils/error.utils.ts'
import { parseSelector, parseSource, select } from './select.ts'

const FIXTURES = fromFileUrl(new URL('../../tests/fixtures/', import.meta.url))

const read = (name: string): { path: string; source: string } => {
  const path = `${FIXTURES}${name}`
  return { path, source: Deno.readTextFileSync(path) }
}

describe('All Select Tests', () => {
  describe('parseSource', () => {
    it('reads a file down to a program node', () => {
      // Arrange
      const { path, source } = read('14-single-expression.ts')

      // Act & Assert
      assertEquals(parseSource(source, path).type, 'Program')
    })

    it('reads jsx only for a tsx path, since the angle bracket is a cast in a ts file', () => {
      // Arrange
      const { path, source } = read('12-jsx-twins.tsx')

      // Act & Assert: the same text under a .ts name is a syntax error rather than an element.
      assertEquals(parseSource(source, path).type, 'Program')
      assertThrows(() => parseSource(source, 'badge.ts'), CliError)
    })

    it('refuses a file it cannot parse, which beats reporting every node as missing', () => {
      // Act & Assert
      assertThrows(() => parseSource('export const = =', 'broken.ts'), CliError)
    })
  })

  describe('parseSelector', () => {
    it('reads a selector down to a node the matcher takes', () => {
      // Act & Assert
      assertEquals(typeof parseSelector('Literal[value=1]').type, 'string')
    })

    it('reads a value carrying an escaped quote, which is what a literal with an apostrophe needs', () => {
      // Act & Assert
      assertEquals(typeof parseSelector("Literal[value='it\\'s open']").type, 'string')
    })

    it('refuses a selector the parser cannot read, since a typo would otherwise read as stale', () => {
      // Act & Assert
      assertThrows(() => parseSelector('Literal[value='), CliError)
    })
  })

  describe('select', () => {
    it('reports every node a selector names, leaving the count for the caller to judge', () => {
      // Arrange
      const { path, source } = read('10-triplets.ts')

      // Act & Assert: three identical siblings are three matches, which is the ambiguous verdict.
      assertEquals(select(source, path, 'ReturnStatement > CallExpression').length, 3)
    })

    it('reports nothing for a selector naming a node that is not there, which is the stale verdict', () => {
      // Arrange
      const { path, source } = read('14-single-expression.ts')

      // Act & Assert
      assertEquals(select(source, path, "Literal[value='absent']"), [])
    })

    it('carries the range a mutation splices at, taken from the node rather than a search', () => {
      // Arrange
      const { path, source } = read('14-single-expression.ts')

      // Act
      const [match] = select(source, path, 'Literal')

      // Assert
      assertEquals(match?.text, '42')
      assertEquals(source.slice(match?.range[0], match?.range[1]), '42')
    })

    it('descends into a TS-only kind, which estraverse names no children for', () => {
      // Arrange
      const { path, source } = read('04-typescript-kinds.ts')

      // Act & Assert: without the visitor keys these report nothing, and nothing reads as stale.
      assert(select(source, path, 'TSTypeReference').length > 0, 'a type reference is reachable')
      assert(select(source, path, 'TSAsExpression').length > 0, 'an as expression is reachable')
      assert(select(source, path, 'TSEnumMember').length > 0, 'an enum member is reachable')
    })

    it('matches a literal by a value carrying a backslash, once the selector escapes it', () => {
      // Arrange
      const { path, source } = read('03-awkward-literals.ts')

      // Act
      const found = select(source, path, "Literal[value='C:\\\\Users\\\\cache']")

      // Assert
      assertEquals(found.length, 1)
      assertEquals(found[0]?.text, "'C:\\\\Users\\\\cache'")
    })

    it('reads a descendant through a declarator init, which is what separates two twins', () => {
      // Arrange
      const { path, source } = read('09-twins.ts')

      // Act & Assert: the binding name is the only fact telling the two bodies apart.
      assertEquals(select(source, path, "VariableDeclarator[id.name='attempt'] CatchClause").length, 1)
      assertEquals(select(source, path, 'CatchClause').length, 2)
    })
  })
})
