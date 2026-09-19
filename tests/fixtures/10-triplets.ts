// Three identical siblings rather than two, which is strictly harder: a bait that excludes one copy still leaves two.
// The bodies differ in nothing but the binding name, so a two-way discriminator is not enough to land on one.

export const toCents = (amount: number): number => {
  if (amount < 0) return 0

  return Math.round(amount * 100)
}

export const toMillis = (amount: number): number => {
  if (amount < 0) return 0

  return Math.round(amount * 100)
}

export const toBasis = (amount: number): number => {
  if (amount < 0) return 0

  return Math.round(amount * 100)
}
