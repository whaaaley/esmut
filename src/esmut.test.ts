import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from 'node:test'
import { dispatch, isTarget } from './esmut.ts'
import { CliError } from './utils/error.utils.ts'

describe('All Esmut Tests', () => {
  describe('isTarget', () => {
    // A bare path is the run verb, so a word is told from a file before it reads as unknown.
    it('reads every source extension the parser accepts as a target', () => {
      // Act & Assert
      for (const name of ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs']) {
        assertEquals(isTarget(name), true, name)
      }
    })

    // A path separator names a file whatever it ends in, so a directory target is not refused.
    it('reads anything carrying a path separator as a target', () => {
      // Act & Assert
      assertEquals(isTarget('src/lib'), true)
      assertEquals(isTarget('./a.ts'), true)
    })

    // A verb is a word, and reading one as a file would run a plan nobody named.
    it('refuses a bare word and an extension the parser does not read', () => {
      // Act & Assert
      assertEquals(isTarget('query'), false)
      assertEquals(isTarget('bogus'), false)
      assertEquals(isTarget('notes.md'), false)
    })

    // extname reads a dotfile as having no extension, so .ts is a name rather than an extension.
    it('refuses a dotfile, which carries a name rather than an extension', () => {
      // Act & Assert
      assertEquals(isTarget('.ts'), false)
      assertEquals(isTarget('.gitignore'), false)
    })
  })

  describe('dispatch', () => {
    // Naming no command is the one case that cannot be read as a file, so it is refused.
    it('refuses a run naming no command', () => {
      // Act & Assert
      assertThrows(() => dispatch(undefined, []), CliError)
    })

    // A word that is neither a verb nor a path would run a plan for a file that does not exist.
    it('refuses a word that is neither a command nor a path', () => {
      // Act & Assert
      assertThrows(() => dispatch('bogus', []), CliError)
    })

    // query reads two arguments, and a missing selector would match every node in the file.
    it('refuses a query naming no file and one naming no selector', () => {
      // Act & Assert
      assertThrows(() => dispatch('query', []), CliError)
      assertThrows(() => dispatch('query', ['a.ts']), CliError)
    })

    it('refuses a stub and a check naming no file', () => {
      // Act & Assert
      assertThrows(() => dispatch('stub', []), CliError)
      assertThrows(() => dispatch('check', []), CliError)
    })

    // Only check prunes, and a run given the flag would write nothing while looking like it had.
    it('refuses prune on any verb but check', () => {
      // Act & Assert
      assertThrows(() => dispatch('stub', ['a.ts'], { prune: true }), CliError)
      assertThrows(() => dispatch('query', ['a.ts', 'Literal'], { prune: true }), CliError)
      assertThrows(() => dispatch('src/a.ts', [], { prune: true }), CliError)
    })

    // Each verb reaches its own command, and a misrouted verb runs what the caller did not ask for.
    // The absent file is what proves the route: the error names the command that was reached.
    it('routes each verb to the command that names it', async () => {
      // Act & Assert: query reads the file, so an absent one is its error to report.
      const asQuery = await assertRejects(() => dispatch('query', ['absent.ts', 'Literal']), CliError)
      assertEquals(asQuery.message.includes('absent.ts'), true)

      // stub reads the file too, and reaching it means the verb was not read as a target.
      const asStub = await assertRejects(() => dispatch('stub', ['absent.ts']), CliError)
      assertEquals(asStub.message.includes('absent.ts'), true)

      // check reads the plan beside the file rather than the file, telling its route from stub's.
      const asCheck = await assertRejects(() => dispatch('check', ['absent.ts']), CliError)
      assertEquals(asCheck.message.includes('No plan'), true)
    })

    // A bare path is the run verb, so it reaches run rather than the unknown-command refusal.
    it('routes a bare path to the run it names', async () => {
      // Act
      const rejected = await assertRejects(() => dispatch('absent.ts', []), CliError)

      // Assert: run looks for the plan first, which separates it from the unknown-command error.
      assertEquals(rejected.message.includes('No plan'), true)
    })
  })

  describe('the entry point', () => {
    // The guarded block runs only as a program, so it is exercised as one rather than imported.
    const ran = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
      const allow = ['--allow-read', '--allow-write', '--allow-run', '--allow-env', '--allow-sys']

      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', ...allow, 'src/esmut.ts', ...args],
        cwd: new URL('../', import.meta.url).pathname,
        stdout: 'piped',
        stderr: 'piped',
      })

      const { code, stdout, stderr } = await command.output()

      return { code, stdout: new TextDecoder().decode(stdout), stderr: new TextDecoder().decode(stderr) }
    }

    // Help is what a caller reads first, and it ends the run rather than dispatching.
    it('prints the usage and exits zero for the help flag and its alias', async () => {
      // Act
      const long = await ran(['--help'])
      const short = await ran(['-h'])

      // Assert
      assertEquals(long.code, 0)
      assertEquals(short.code, 0)
      assertStringIncludes(long.stdout, 'Usage: esmut')
      assertEquals(short.stdout, long.stdout)
    })

    // Help is the only place a caller learns which words the CLI answers to.
    it('names every verb and option under the headings that sort them', async () => {
      // Act
      const { stdout } = await ran(['--help'])

      // Assert
      assertStringIncludes(stdout, 'Commands:')
      assertStringIncludes(stdout, '  query <file> <selector>')
      assertStringIncludes(stdout, '  stub <file>')
      assertStringIncludes(stdout, '  check <file|dir>')
      assertStringIncludes(stdout, '  <file|dir>')
      assertStringIncludes(stdout, 'Options:')
      assertStringIncludes(stdout, '  --help, -h')
    })

    // A survivor is a finding rather than a failure, which the exit code alone cannot say.
    it('states that the exit code stays zero whether or not a mutation survived', async () => {
      // Act
      const { stdout } = await ran(['--help'])

      // Assert
      assertStringIncludes(stdout, 'Exit code stays 0 whether or not\na mutation survived.')
    })

    // Declaring help boolean lets a caller turn it off, where undeclared it takes 'false' as text.
    it('runs rather than printing help when the flag is set to false', async () => {
      // Act
      const { code, stdout, stderr } = await ran(['--help=false'])

      // Assert
      assertEquals(code, 1)
      assertEquals(stdout, '')
      assertStringIncludes(stderr, 'error: Missing command')
    })

    // A refusal prints to stderr and exits one, which separates it from a run that found nothing.
    it('prints a refusal to stderr and exits one', async () => {
      // Act
      const { code, stdout, stderr } = await ran([])

      // Assert
      assertEquals(code, 1)
      assertEquals(stdout, '')
      assertStringIncludes(stderr, 'error: Missing command')
    })

    // A survivor is a finding to read rather than a gate to fail, so a complete run exits zero.
    it('exits zero after a command that completed', async () => {
      // Act
      const { code, stdout } = await ran(['query', 'src/utils/error.utils.ts', 'ClassDeclaration'])

      // Assert
      assertEquals(code, 0)
      assertStringIncludes(stdout, '1 match')
    })
  })
})
