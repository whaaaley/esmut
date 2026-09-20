import { assertEquals } from '@std/assert'
import { describe, it } from 'node:test'
import { excuses } from './ignore.ts'
import { stubPlan } from './stub.ts'
import { indexSource } from './walk.ts'

const linesOf = (source: string): Map<number, string> => indexSource(source, 'x.ts').excused

const addressesOf = (source: string): string[] => stubPlan(source, 'x.ts').mutations.map((mutation) => mutation.at)

describe('All Ignore Tests', () => {
  describe('ignored', () => {
    // The marker sits above the code it excuses, which is where ts-ignore and deno-lint-ignore go.
    it('excuses the line below a marker on its own line', () => {
      // Act
      const lines = linesOf('const a = 1\n// esmut-ignore\nconst b = 2\n')

      // Assert
      assertEquals([...lines.keys()], [3])
    })

    // A marker at the end of a line excuses that line, for a site with no room above it.
    it('excuses its own line where the marker names the line', () => {
      // Act
      const lines = linesOf('const a = 1 // esmut-ignore-line\nconst b = 2\n')

      // Assert
      assertEquals([...lines.keys()], [1])
    })

    it('keeps the reason an author wrote after the marker', () => {
      // Act
      const lines = linesOf('// esmut-ignore only the call count differs\nconst a = 1\n')

      // Assert
      assertEquals(lines.get(2), 'only the call count differs')
    })

    it('reads a marker carrying no reason as a marker all the same', () => {
      // Act
      const lines = linesOf('// esmut-ignore\nconst a = 1\n')

      // Assert
      assertEquals(lines.get(2), '')
    })

    // A word the marker is a prefix of is not the marker, or a near miss would excuse code silently.
    it('refuses a comment whose first word merely starts with the marker', () => {
      // Act
      const lines = linesOf('// esmut-ignoring this for now\nconst a = 1\n')

      // Assert
      assertEquals(lines.size, 0)
    })

    it('takes no ordinary comment for a marker', () => {
      // Act
      const lines = linesOf('// what this does\nconst a = 1\n')

      // Assert
      assertEquals(lines.size, 0)
    })
  })

  describe('excuses', () => {
    it('reads a node by the line it starts on', () => {
      // Arrange
      const indexed = indexSource('// esmut-ignore\nconst a = 1\n', 'x.ts')
      const [node] = indexed.byType.get('Literal') ?? []

      if (!node) throw new Error('no Literal in the source')

      // Act & Assert
      assertEquals(excuses(indexed.excused, node), true)
    })
  })

  describe('stubPlan', () => {
    // What the feature is for: a site nobody can test stays out of the plan rather than surviving.
    it('leaves an excused site out of the plan', () => {
      // Act
      const addresses = addressesOf('const a = (n: number): number =>\n  // esmut-ignore\n  n > 0 ? 1 : 2\n')

      // Assert
      assertEquals(addresses, [])
    })

    // A marker excuses one line, so the code under it keeps every site it had.
    it('keeps a site on a line no marker names', () => {
      // Arrange
      const source = 'const a = (n: number): number => {\n  // esmut-ignore\n  if (n > 0) return 1\n  return 2\n}\n'

      // Act
      const addresses = addressesOf(source)

      // Assert
      assertEquals(addresses.includes('ReturnStatement[argument.value=2]'), true)
      assertEquals(addresses.some((at) => at.includes("operator='>'")), false)
    })
  })
})
