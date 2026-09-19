// One value in every role it takes: a key, a value, an argument, a comparison, and an array element.
// The value attribute is the generator's cheapest discriminator, so repeating it forces the scope tiers to do the work.

const topics = ['help', 'status', 'version']

export const route = (name: string, flags: Record<string, string>): string => {
  if (name === 'help') return 'help'

  if (flags.help === 'help') return topics[0] ?? 'help'

  return lookup('help')
}

const lookup = (topic: string): string => {
  const table = { help: 'help', status: 'ready' }

  return table.help === topic ? 'help' : 'unknown'
}
