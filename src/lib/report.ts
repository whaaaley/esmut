import { basename } from '@std/path'
import type { Merged } from './plan.ts'
import type { Match } from './select.ts'
import type { Verdict } from './run.ts'
import type { Mutation } from './schema.ts'

export type Resolved = {
  mutation: Mutation
  matches: number
}

// Every line of a node, the first on the line the caller built and the rest indented under it.
// Nothing is withheld, since a reader deciding whether a site is theirs needs all of it.
// The lines are kept apart rather than joined, which would read as source that does not parse.
const asLines = (text: string, indent: string): string[] => {
  const [first = '', ...rest] = text.split('\n')
  const kept = [first.trimEnd()]

  // Trailing blank lines carry nothing, so they are dropped rather than printed as empty rows.
  while (rest.length > 0 && (rest.at(-1) ?? '').trim() === '') rest.pop()

  for (const line of rest) kept.push(`${indent}${line.trimEnd()}`)

  return kept
}

// Leads with the count because that is the signal: 0 is stale, 1 is usable, more is ambiguous.
export const formatMatches = (path: string, matches: Match[]): string => {
  const count = matches.length === 1 ? '1 match' : `${matches.length} matches`
  const lines = [`  ${count}`]

  // ESTree counts the first column as zero while counting the first line as one.
  // A reader jumps to the location in an editor, which counts the first column as one.
  // Width comes from the longest location so the source column lines up at any line number.
  const locations = matches.map((match) => `${basename(path)}:${match.line}:${match.column + 1}`)
  const width = Math.max(...locations.map((location) => location.length))

  for (const [index, match] of matches.entries()) {
    const location = locations[index] ?? ''
    const indent = ' '.repeat(4 + width + 2)
    const [head = '', ...tail] = asLines(match.text, indent)

    lines.push(`    ${location.padEnd(width + 2)}${head}`, ...tail)
  }

  return lines.join('\n')
}

// Leads with what was written, then what needs a person: an unfilled op is the plan's whole point.
export const formatStub = (path: string, merged: Merged): string => {
  const { plan, kept, added, stale } = merged
  const unfilled = plan.mutations.filter((mutation) => mutation.op === null).length

  const lines = [`  wrote ${basename(path)}`, `    ${plan.mutations.length} sites`]

  if (kept > 0) lines.push(`    ${kept} kept, op and name intact`)
  if (added > 0) lines.push(`    ${added} added`)
  if (unfilled > 0) lines.push(`    ${unfilled} awaiting an op`)

  for (const mutation of stale) {
    lines.push(`    stale  ${mutation.at}`)
  }

  // The structures are named rather than diffed, since a hash has no lines to show.
  // The selector is what a reader opens to judge whether the op still means what they meant.
  for (const drift of merged.drifted) {
    lines.push(`    drifted  ${drift.at}`)
    lines.push(`      ${drift.before} became ${drift.after}`)
  }

  if (!plan.cmd) lines.push(`    name a cmd before running, since a plan with none cannot run`)

  return lines.join('\n')
}

// Leads with the survivors, since a killed mutation is expected and a survivor is the finding.
export const formatVerdicts = (path: string, verdicts: Verdict[]): string => {
  const counted = new Map<string, number>()

  for (const verdict of verdicts) {
    counted.set(verdict.outcome, (counted.get(verdict.outcome) ?? 0) + 1)
  }

  const lines = [`  ${basename(path)}`]

  for (const verdict of verdicts.filter((entry) => entry.outcome === 'survived')) {
    lines.push(`    survived  ${verdict.mutation.name || verdict.mutation.at}`)
  }

  for (const verdict of verdicts.filter((entry) => entry.outcome === 'invalid')) {
    lines.push(`    invalid   ${verdict.mutation.name || verdict.mutation.at}`)
    if (verdict.because) lines.push(`              ${verdict.because}`)
  }

  const tally = [...counted].map(([outcome, count]) => `${count} ${outcome}`).join(', ')

  return `${lines.join('\n')}\n    ${tally || 'nothing planned'}`
}

// A selector matching nothing is stale, one matching several is ambiguous, and both refuse to run.
export const formatCheck = (path: string, resolved: Resolved[]): string => {
  const lines = [`  ${basename(path)}`]

  for (const { mutation, matches } of resolved) {
    if (matches === 1) continue

    const verdict = matches === 0 ? 'stale    ' : 'ambiguous'
    lines.push(`    ${verdict}  ${mutation.at}`)
  }

  const bad = resolved.filter((entry) => entry.matches !== 1).length

  return `${lines.join('\n')}\n    ${resolved.length} resolved, ${bad} refused`
}
