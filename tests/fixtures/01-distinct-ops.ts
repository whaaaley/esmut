// Every op at a site nothing else in the file resembles, so a bare type or one attribute addresses it.
// This is the floor: if a selector is not unique here, the generator is broken rather than merely outmatched.

export const rank = (score: number, bonus: number, tags: string[]): string => {
  if (score < 0) return 'invalid'

  const total = score + bonus
  const tier = total > 90 ? 'gold' : 'silver'
  const eligible = total > 10 && tags.length > 0

  if (!eligible) return 'unranked'

  const label = `${tier}-${total}`

  return label
}

export const defaults = {
  retries: 3,
  verbose: false,
  hosts: ['alpha', 'beta'],
}

export const reset = (): void => {
  defaults.retries = 0
}
