import type { TSESTree } from '@typescript-eslint/typescript-estree'

// The marker an author writes above a line to keep its sites out of a plan.
export const IGNORE = 'esmut-ignore'

// The marker's own line, which keeps every site on that line out rather than the line below.
export const IGNORE_LINE = 'esmut-ignore-line'

// A comment carrying a marker, and the line whose sites it excuses.
type Excused = {
  line: number
  why: string
}

// Reads a marker and takes whatever follows it as the reason.
// A marker with no reason is still a marker, since the comment itself says enough.
const excused = (comment: TSESTree.Comment): Excused | null => {
  const text = comment.value.trim()

  if (text === IGNORE_LINE || text.startsWith(`${IGNORE_LINE} `)) {
    return { line: comment.loc.start.line, why: text.slice(IGNORE_LINE.length).trim() }
  }

  if (text === IGNORE || text.startsWith(`${IGNORE} `)) {
    return { line: comment.loc.end.line + 1, why: text.slice(IGNORE.length).trim() }
  }

  return null
}

// Every line an author has excused, by the line the sites sit on.
// A line carrying its own marker excuses itself, where a marker on its own line excuses the next.
export const ignored = (comments: TSESTree.Comment[]): Map<number, string> => {
  const lines = new Map<number, string>()

  for (const comment of comments) {
    const found = excused(comment)
    if (found) lines.set(found.line, found.why)
  }

  return lines
}

// Whether a node starts on an excused line, which is what keeps its site out of a plan.
// The start is what counts, so a marker excuses a call rather than its arguments on later lines.
export const excuses = (lines: Map<number, string>, node: TSESTree.Node): boolean => (
  lines.has(node.loc.start.line)
)
