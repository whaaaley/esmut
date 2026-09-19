export class CliError extends Error {
  suggestions: string[]

  constructor(message: string, suggestions: string[] = []) {
    super(message)
    this.name = this.constructor.name
    this.suggestions = suggestions
  }
}
