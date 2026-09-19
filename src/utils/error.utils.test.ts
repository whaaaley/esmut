import { assertEquals, assertInstanceOf } from '@std/assert'
import { describe, it } from 'node:test'
import { CliError } from './error.utils.ts'

describe('All Error Utils Tests', () => {
  describe('CliError', () => {
    it('carries the message and the suggestions it was given', () => {
      // Act
      const error = new CliError('Cannot read the plan', ['Check the path', 'Run with --help'])

      // Assert
      assertEquals(error.message, 'Cannot read the plan')
      assertEquals(error.suggestions, ['Check the path', 'Run with --help'])
    })

    // The printer walks suggestions, so an error raised without them needs a list, not undefined.
    it('carries an empty list where none were given, since the printer walks them', () => {
      // Act
      const error = new CliError('Missing command')

      // Assert
      assertEquals(error.suggestions, [])
    })

    // handleCliError tells a CliError from a genuine bug by instance, and rethrows what is not one.
    it('is an Error, which is what separates a refusal from a bug at the boundary', () => {
      // Act
      const error = new CliError('Missing command')

      // Assert
      assertInstanceOf(error, Error)
      assertInstanceOf(error, CliError)
      assertEquals(error.name, 'CliError')
    })
  })
})
