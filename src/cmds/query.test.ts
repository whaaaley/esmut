import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from 'node:test'
import { query } from './query.ts'
import { CliError } from '../utils/error.utils.ts'

const written = (source: string): string => {
  const path = `${Deno.makeTempDirSync()}/redact.ts`
  Deno.writeTextFileSync(path, source)

  return path
}

// The command prints, so what it printed is the only evidence the pieces were wired together.
const printed = async (run: () => Promise<void>): Promise<string> => {
  const lines: string[] = []
  const log = console.log

  console.log = (line: string): void => {
    lines.push(line)
  }

  try {
    await run()
  } finally {
    console.log = log
  }

  return lines.join('\n')
}

describe('All Query Command Tests', () => {
  describe('query', () => {
    // Every library the command calls has its own tests, and none assert it reaches the printer.
    it('prints what the selector matched, which is the only proof the match reached the printer', async () => {
      // Arrange
      const path = written("const key = '[unset]'\n")

      // Act
      const output = await printed(() => query(path, "Literal[value='[unset]']"))

      // Assert
      assertStringIncludes(output, '1 match')
      assertStringIncludes(output, "'[unset]'")
    })

    // Nothing matched is a verdict a reader acts on rather than a failure, so it prints.
    it('prints a count of nothing rather than refusing a selector that matched nothing', async () => {
      // Arrange
      const path = written("const key = '[unset]'\n")

      // Act
      const output = await printed(() => query(path, 'Literal[value=999]'))

      // Assert
      assertStringIncludes(output, '0 matches')
    })

    // A file that cannot be read is the caller's to fix, and naming it beats a stack trace.
    it('refuses a file it cannot read', async () => {
      // Act
      const refused = await assertRejects(() => query('/absent/redact.ts', 'Literal'), CliError)

      // Assert
      assertStringIncludes(refused.message, '/absent/redact.ts')
    })

    // A selector the parser refuses is a typo, and reporting nothing matched would read as stale.
    it('refuses a selector the parser cannot read', async () => {
      // Arrange
      const path = written("const key = '[unset]'\n")

      // Act & Assert
      const refused = await assertRejects(() => query(path, 'Literal >>> Bogus'), CliError)
      assertEquals(refused instanceof CliError, true)
    })
  })
})
