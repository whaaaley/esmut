import ts from 'typescript'
import { CliError } from '../utils/error.utils.ts'
import { safe } from '../utils/safe.utils.ts'

export type Diagnostic = {
  code: number
  line: number
  message: string
}

// A diagnostic the baseline did not carry means the mutation broke the build rather than the tests.
// Identity is compared rather than cardinality: a mutation can clear one error and add another.
// A count unchanged would read as compiling, and the build failure would surface as a test failure.
// That reads as killed, which is the false green the whole tool exists to refuse.
export const introduced = (baseline: Diagnostic[], mutant: Diagnostic[]): Diagnostic[] => {
  const seen = new Map<string, number>()

  for (const diagnostic of baseline) {
    const key = `${diagnostic.code}:${diagnostic.message}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  const fresh: Diagnostic[] = []

  for (const diagnostic of mutant) {
    const key = `${diagnostic.code}:${diagnostic.message}`
    const carried = seen.get(key) ?? 0

    if (carried > 0) {
      seen.set(key, carried - 1)
      continue
    }

    fresh.push(diagnostic)
  }

  return fresh
}

const COMPILER_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  // allowJs admits a JavaScript file and checkJs makes the compiler report anything about it.
  // Without both, the gate passes every mutant in a .js file unchecked, the false green it refuses.
  checkJs: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

// Holds what every mutant of one source shares: the parse of each file it imports, and the program
// TypeScript built last time. Only the mutant differs, so rebuilding these per mutation reread and
// reparsed the whole import graph, which measured 290ms against 23ms.
export type Gate = {
  path: string
  base: ts.CompilerHost
  unchanged: Map<string, ts.SourceFile>
  prior: ts.Program | undefined
}

export const openGate = (path: string): Gate => ({
  path,
  base: ts.createCompilerHost(COMPILER_OPTIONS),
  unchanged: new Map(),
  prior: undefined,
})

// Reads the mutant from memory rather than disk, so it is checked without being written anywhere.
const host = (gate: Gate, source: string): ts.CompilerHost => ({
  ...gate.base,
  getSourceFile: (name, language, onError, shouldCreate) => {
    // The mutant differs per call, so it is the one file never taken from the cache.
    if (name === gate.path) return ts.createSourceFile(name, source, language)

    const seen = gate.unchanged.get(name)
    if (seen) return seen

    const made = gate.base.getSourceFile(name, language, onError, shouldCreate)
    if (made) gate.unchanged.set(name, made)

    return made
  },
  // getSourceFile answers every question the program asks about the target, so this is never asked
  // for it: measured at 86 reads per check, none of them the target. It stays because a host owes a
  // consistent answer on both, and a mutation of the test here is a mutant no test can catch.
  readFile: (name) => name === gate.path ? source : gate.base.readFile(name),
})

// Diagnostics the compiler reports for one file, which is the only file a mutation touches.
// The gate carries what the last mutant parsed, so each call reads one file not a graph.
export const diagnose = (gate: Gate, source: string): Diagnostic[] => {
  const path = gate.path

  const { data, error } = safe(() => {
    const program = ts.createProgram([path], COMPILER_OPTIONS, host(gate, source), gate.prior)
    gate.prior = program

    const file = program.getSourceFile(path)

    if (!file) return []

    return [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]
  })

  if (error) {
    throw new CliError(`Cannot type-check ${path}`, [
      error.message,
      'The gate compares a mutant against the file it came from',
    ])
  }

  return data.map((diagnostic) => {
    // A syntactic or semantic diagnostic always carries the position ts.Diagnostic calls optional.
    // Refusing one without a position beats reporting line zero, which points a reader at no line.
    const { file, start } = diagnostic

    if (!file || start === undefined) {
      throw new CliError(`A diagnostic for ${path} carries no position`, [
        'diagnose reads only the syntactic and semantic diagnostics of one file, which always carry one',
      ])
    }

    const line = file.getLineAndCharacterOfPosition(start).line + 1

    return {
      code: diagnostic.code,
      line,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    }
  })
}
