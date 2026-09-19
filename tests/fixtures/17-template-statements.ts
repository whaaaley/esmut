// Statements sharing a callee and a shape, so only the fixed text of the template tells them apart.
// A string literal would be a bait already, where a template's text sits under TemplateElement.

export const describe = (kind: string, count: number): string[] => {
  const lines: string[] = []

  lines.push(`the ${kind} carries no condition`)
  lines.push(`the ${kind} carries no argument`)
  lines.push(`the ${kind} holds ${count} of them`)

  return lines
}
