// Comparisons whose operands are not bare identifiers, so [left.name] and [right.name] name nothing.
// Each pair sits under one parent at one depth sharing an operator, so the operand is the only separating fact.

export const negated = (target: { type: string; operator?: string }): boolean => {
  return target.type === 'UnaryExpression' && target.operator === '!'
}

export const guarded = (node: { kind: string }, value: number): string => {
  if (node.kind === 'Literal' && value === 0) return 'zero'
  return 'other'
}
