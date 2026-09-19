// The same statement inside a loop body and again after it, where the only difference is the enclosing block.
// No ancestor carries a name or a distinctive literal, so the scopes tier must lean on the loop's own type.

export const drain = (queue: number[], limit: number): number => {
  let total = 0

  for (const item of queue) {
    if (item > limit) continue

    total += item
  }

  while (total > limit) {
    total -= limit
  }

  total += 1

  return total
}
