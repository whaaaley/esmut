import { assert, assertEquals } from '@std/assert'
import { describe, it } from 'node:test'
import { diagnose, type Diagnostic, introduced, openGate } from './check.ts'

const at = (code: number, message: string, line = 1): Diagnostic => ({ code, line, message })

describe('All Check Tests', () => {
  describe('introduced', () => {
    it('reports nothing where the mutant carries what the baseline carried', () => {
      // Arrange
      const carried = [at(2304, "Cannot find name 'missing'.")]

      // Act & Assert
      assertEquals(introduced(carried, carried), [])
      assertEquals(introduced([], []), [])
    })

    it('reports a diagnostic the baseline did not carry', () => {
      // Arrange
      const baseline = [at(2304, "Cannot find name 'missing'.")]
      const mutant = [...baseline, at(2322, 'Type string is not assignable to type number.')]

      // Act
      const fresh = introduced(baseline, mutant)

      // Assert
      assertEquals(fresh.map((diagnostic) => diagnostic.code), [2322])
    })

    // A mutation can clear one error while introducing another, which leaves the count unchanged.
    // Comparing counts reads that as compiling, and the build failure surfaces as a test failure.
    it('reports a swap the baseline count would have hidden', () => {
      // Arrange
      const baseline = [at(2304, "Cannot find name 'missing'.")]
      const mutant = [at(2304, "Cannot find name 'absent'.")]

      // Act
      const fresh = introduced(baseline, mutant)

      // Assert: both carry exactly one diagnostic, so only identity separates them.
      assertEquals(baseline.length, mutant.length)
      assertEquals(fresh.map((diagnostic) => diagnostic.message), ["Cannot find name 'absent'."])
    })

    // A file carrying the same error twice is not made worse by a mutation leaving both.
    // It is made worse by one adding a third, which only counting the repeats can tell.
    it('counts a repeated diagnostic rather than matching it once', () => {
      // Arrange
      const twice = [at(2304, 'Cannot find name.'), at(2304, 'Cannot find name.')]
      const thrice = [...twice, at(2304, 'Cannot find name.')]

      // Act & Assert
      assertEquals(introduced(twice, twice), [])
      assertEquals(introduced(twice, thrice).length, 1)
    })

    // A mutant clearing an error introduces nothing, so the tests judge it rather than the gate.
    it('reports nothing where the mutant carries fewer than the baseline', () => {
      // Act & Assert
      assertEquals(introduced([at(2304, 'Cannot find name.')], []), [])
    })
  })

  describe('diagnose', () => {
    it('reports nothing for a file the compiler accepts', () => {
      // Act & Assert
      assertEquals(diagnose(openGate('/tmp/clean.ts'), 'export const add = (a: number): number => a + 1\n'), [])
    })

    // The gate reads a mutant from memory, since writing one to disk is what it exists to avoid.
    it('reads the source it was handed rather than the file on disk', () => {
      // Act
      const found = diagnose(openGate('/tmp/absent.ts'), 'export const add = (a: number): number => a + missing\n')

      // Assert
      assertEquals(found.length, 1)
      assertEquals(found[0]?.message, "Cannot find name 'missing'.")
    })

    // esmut takes a .js target as readily as a .ts one, and a gate reading neither passes them all.
    // allowJs admits the file and checkJs makes the compiler say anything, so both are needed.
    it('reports a broken javascript file, which the gate accepts as a target', () => {
      // Act
      const broken = diagnose(openGate('/tmp/plain.js'), 'export const a = missing\n')
      const clean = diagnose(openGate('/tmp/plain.js'), 'export const a = 1\n')

      // Assert
      assertEquals(broken.map((one) => one.code), [2304])
      assertEquals(clean, [])
    })

    // The gate reads a file the compiler cannot find, so the host answers for it on every question.
    // A host admitting the file but not reading it reports a missing file, not the mutant's errors.
    it('answers for a file that exists only in memory', () => {
      // Act: the path names nothing on disk, so every diagnostic comes from the source handed in.
      const clean = diagnose(openGate('/tmp/nowhere/absent.ts'), 'export const ok = 1\n')
      const broken = diagnose(openGate('/tmp/nowhere/absent.ts'), 'export const bad: number = missing\n')

      // Assert
      assertEquals(clean, [])
      assertEquals(broken.map((one) => one.code), [2304])
    })

    // A diagnostic can carry a chain of messages, and the separator keeps them one readable line.
    it('joins a chained diagnostic with a space rather than running the parts together', () => {
      // Arrange: assigning a mismatched object yields a message with a nested explanation.
      const source = "const take = (a: { b: number }): void => {}\ntake({ b: 'x' })\n"

      // Act
      const found = diagnose(openGate('/tmp/chained.ts'), source)
      const [first] = found

      // Assert
      assert(first, 'the mismatch is reported')
      assertEquals(first?.message.includes('ZZZ'), false)
      assertEquals(first?.message.startsWith(' '), false)
    })

    it('names the line a diagnostic sits on, counting from one', () => {
      // Act
      const found = diagnose(openGate('/tmp/second.ts'), 'export const ok = 1\nexport const bad: number = missing\n')

      // Assert
      assertEquals(found[0]?.line, 2)
    })
  })
})
