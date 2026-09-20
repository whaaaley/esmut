import { assertEquals } from '@std/assert'
import { describe, it } from 'node:test'
import { counter, pin } from './pin.ts'
import { matchAll } from './query.ts'
import { parseSelector } from './select.ts'
import { indexSource } from './walk.ts'
import type { Indexed } from './walk.ts'

// The counter pin is given, which answers how many nodes a selector names.
const counting = (indexed: Indexed): { count: (at: string) => number; asked: string[] } => {
  const asked: string[] = []

  const count = (at: string): number => {
    asked.push(at)

    return matchAll(indexed.ast, parseSelector(at)).length
  }

  return { count, asked }
}

const pinOf = (source: string, type: string): string => {
  const indexed = indexSource(source, 'x.ts')
  const [node] = indexed.byType.get(type) ?? []

  if (!node) throw new Error(`no ${type} in the source`)

  const { count } = counting(indexed)

  return pin(indexed, node, count).at
}

describe('All Pin Tests', () => {
  describe('pin', () => {
    // An attribute is read off the node, where a path makes esquery walk, so content comes first.
    it('names a node by its own content where that is enough', () => {
      // Act & Assert
      assertEquals(pinOf('const a = 42\n', 'Literal'), 'Literal[value=42]')
    })

    it('names an identifier by the name it carries', () => {
      // Act & Assert
      assertEquals(pinOf('const only = 1\n', 'Identifier'), "Identifier[name='only']")
    })

    // A backslash in the value would start an escape inside the quoted selector, so it is doubled.
    it('doubles a backslash in a pinned value', () => {
      // Act & Assert
      assertEquals(pinOf('const a = "back\\\\slash"\n', 'Literal'), "Literal[value='back\\\\slash']")
    })

    // The selector quotes with an apostrophe, so one in the value has to be escaped to stay inside.
    it('escapes a single quote in a pinned value', () => {
      // Act & Assert
      assertEquals(pinOf('const a = "it\'s"\n', 'Literal'), "Literal[value='it\\'s']")
    })

    // An escaped value has to survive the round trip, or pin names a node esquery cannot find.
    it('returns an escaped selector esquery resolves to the one node it names', () => {
      // Arrange
      const indexed = indexSource('const a = "q\'and\\\\b"\n', 'x.ts')
      const [node] = indexed.byType.get('Literal') ?? []

      if (!node) throw new Error('no Literal in the source')

      const { count } = counting(indexed)

      // Act
      const { at } = pin(indexed, node, count)

      // Assert
      assertEquals(matchAll(indexed.ast, parseSelector(at)).length, 1)
    })

    // The visitor list names left and right but not operator, so only SCALAR_KEYS reaches it.
    it('names a comparison by its operator where both operands are shared', () => {
      // Arrange
      const source = 'const f = (a: number, b: number): boolean => a < b || a > b\n'

      // Act
      const at = pinOf(source, 'BinaryExpression')

      // Assert
      assertEquals(at, "BinaryExpression[operator='<']")
    })

    // An attribute two keys deep is what REACH allows, and it takes both descents to build.
    it('names a node by an attribute two keys below it', () => {
      // Arrange
      const source = 'const f = (o: { a: { b: number } }): number => {\n  if (o.a.b === 7) return 1\n  return 2\n}\n'

      // Act
      const at = pinOf(source, 'IfStatement')

      // Assert
      assertEquals(at, 'IfStatement[test.right.value=7]')
    })

    // A deeper chain still pins at the reach, so the prefix never grows a third key.
    it('names a node by an attribute no deeper than the reach allows', () => {
      // Arrange
      const source = 'const f = (o: { a: { b: { c: number } } }): number => {\n  if (o.a.b.c) return 1\n  return 2\n}\n'

      // Act
      const at = pinOf(source, 'IfStatement')

      // Assert
      assertEquals(at, "IfStatement[test.property.name='c']")
    })

    // Two literals of the same value share every attribute, so the path is what separates them.
    it('falls back to the path where content names more than one node', () => {
      // Arrange
      const source = 'const a = 1\nconst b = 1\n'

      // Act
      const at = pinOf(source, 'Literal')

      // Assert
      assertEquals(at.includes(' > '), true)
      assertEquals(at.endsWith('Literal.init'), true)
    })

    // Every selector pin returns must name exactly the node it was given, which is the whole point.
    it('returns a selector resolving to one node for every site in a file', () => {
      // Arrange
      const source = 'const f = (a: number): number => {\n  if (a > 0) return 1\n  return a > 0 ? 2 : 3\n}\n'
      const indexed = indexSource(source, 'x.ts')
      const { count } = counting(indexed)

      // Act
      const pinned = [...indexed.byType.values()].flat().map((node) => pin(indexed, node, count))

      // Assert
      assertEquals(pinned.every((entry) => entry.matches === 1), true)
    })

    // The last resort returns the path with its real count, so a caller can tell it did not resolve.
    it('reports the count it found where nothing separates a node from its twin', () => {
      // Arrange
      const indexed = indexSource('const a = 1\n', 'x.ts')
      const [node] = indexed.byType.get('Literal') ?? []

      if (!node) throw new Error('no Literal in the source')

      const { count } = counting(indexed)

      // Act
      const { matches } = pin(indexed, node, count)

      // Assert
      assertEquals(matches, 1)
    })

    // A counter answers for the tree it was built from, so two of them disagree on the same
    // selector. That is what makes the cache safe to keep for a whole file and no longer.
    it('counts against the tree it was built from rather than the last one asked', () => {
      // Arrange
      const one = counter(indexSource('const a = 1\n', 'x.ts'))
      const two = counter(indexSource('const a = 1\nconst b = 1\n', 'y.ts'))

      // Act & Assert
      assertEquals(one('Literal[value=1]'), 1)
      assertEquals(two('Literal[value=1]'), 2)
      assertEquals(one('Literal[value=1]'), 1)
    })

    // Two nodes of a kind try the same attributes, so the second asks what the first already did.
    // That repeat across nodes is what the caller's memo absorbs, and one pin never repeats itself.
    it('asks a selector a node of the same kind has already asked', () => {
      // Arrange
      const indexed = indexSource('const a = 1\nconst b = 1\n', 'x.ts')
      const literals = indexed.byType.get('Literal') ?? []
      const { count, asked } = counting(indexed)

      // Act
      for (const node of literals) pin(indexed, node, count)

      // Assert
      assertEquals(literals.length, 2)
      assertEquals(asked.length > new Set(asked).size, true)
    })
  })
})
