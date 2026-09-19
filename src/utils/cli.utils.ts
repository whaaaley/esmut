import { CliError } from './error.utils.ts'

// Prints a CliError as `error: <message>` plus bullet suggestions on stderr and exits 1.
// Re-throws anything else so genuine bugs keep their stack trace.
export const handleCliError = (error: unknown): never => {
  const isCliError = error instanceof CliError
  if (!isCliError) throw error

  console.error(`error: ${error.message}`)
  for (const suggestion of error.suggestions) {
    console.error(`  - ${suggestion}`)
  }

  return Deno.exit(1)
}
