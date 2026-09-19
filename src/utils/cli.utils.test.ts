import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from 'node:test'
import { handleCliError } from './cli.utils.ts'
import { CliError } from './error.utils.ts'
import { safe } from './safe.utils.ts'

// handleCliError ends the process, so it is exercised in one rather than in this one.
// The script prints what the handler prints and exits as it exits, which is the whole contract.
const handled = async (script: string): Promise<{ code: number; stderr: string }> => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['eval', '--no-lock', script],
    cwd: new URL('../../', import.meta.url).pathname,
    stdout: 'null',
    stderr: 'piped',
  })

  const { code, stderr } = await command.output()

  return { code, stderr: new TextDecoder().decode(stderr) }
}

const IMPORTS = `
  const { handleCliError } = await import('./src/utils/cli.utils.ts')
  const { CliError } = await import('./src/utils/error.utils.ts')
`

describe('All Cli Utils Tests', () => {
  describe('handleCliError', () => {
    // A refusal is the user's to act on, so it prints its message and suggestions and ends.
    it('prints a refusal with its suggestions and exits one', async () => {
      // Act
      const { code, stderr } = await handled(`
        ${IMPORTS}
        handleCliError(new CliError('Cannot read the plan', ['Check the path', 'Run with --help']))
      `)

      // Assert
      assertEquals(code, 1)
      assertStringIncludes(stderr, 'error: Cannot read the plan')
      assertStringIncludes(stderr, '  - Check the path')
      assertStringIncludes(stderr, '  - Run with --help')
    })

    // An error carrying no suggestions still names what went wrong, and the walk must not fail.
    it('prints a refusal carrying no suggestions', async () => {
      // Act
      const { code, stderr } = await handled(`
        ${IMPORTS}
        handleCliError(new CliError('Missing command'))
      `)

      // Assert
      assertEquals(code, 1)
      assertStringIncludes(stderr, 'error: Missing command')
      assertEquals(stderr.includes('  - '), false)
    })

    // Anything that is not a refusal is a bug in esmut, and swallowing it hides the stack trace.
    it('rethrows what is not a refusal, so a bug keeps its stack trace', async () => {
      // Act
      const { code, stderr } = await handled(`
        ${IMPORTS}
        handleCliError(new TypeError('a genuine bug'))
      `)

      // Assert: an uncaught throw exits non-zero and names the type, where a refusal would not.
      assertEquals(code === 0, false)
      assertStringIncludes(stderr, 'a genuine bug')
      assertEquals(stderr.includes('error: a genuine bug'), false)
    })

    // The rethrow returns before the exit, so it is the one branch this process can take.
    it('rethrows the very error it was handed, in this process', () => {
      // Arrange
      const bug = new TypeError('a genuine bug')

      // Act
      const { error } = safe(() => handleCliError(bug))

      // Assert: the same error object rather than a wrapping, so the stack trace still locates it.
      assertEquals(error, bug)
    })

    // A thrown string is not an Error, and the handler must still refuse to treat it as a refusal.
    it('rethrows what is not an error at all', () => {
      // Act
      const { error } = safe(() => handleCliError('not an error'))

      // Assert
      assertEquals(error instanceof CliError, false)
      assertStringIncludes(String(error), 'not an error')
    })
  })
})
