import { fromFileUrl } from '@std/path'
import { pin } from './pin.ts'
import { matchAll } from './query.ts'
import { parseSelector } from './select.ts'
import { sites, stubPlan } from './stub.ts'
import { indexSource } from './walk.ts'

// Stubbing the corpus is what makes stub.test.ts and corpus.test.ts the two slowest suites,
// and those two are the cmd of the two slowest plans, so this is the cost a run multiplies.
const FIXTURES = fromFileUrl(new URL('../../tests/fixtures/', import.meta.url))

const read = (name: string): { path: string; source: string } => {
  const path = `${FIXTURES}${name}`
  return { path, source: Deno.readTextFileSync(path) }
}

// The three that resist a short address, since each repeats its content or its structure.
// A fixture whose first attribute resolves says nothing about what a stub waits for.
const HARDEST = ['11-deep-nesting.ts', '05-http-handler.ts', '06-repeated-literals.ts']

const INDEXED = HARDEST.map((name) => {
  const { path, source } = read(name)
  return { name, indexed: indexSource(source, path) }
})

// One count per selector, which is what stubPlan gives pin so a shape is matched once per file.
const counter = (indexed: ReturnType<typeof indexSource>): (at: string) => number => {
  const counted = new Map<string, number>()

  return (at: string): number => {
    const seen = counted.get(at)
    if (seen !== undefined) return seen

    const hits = matchAll(indexed.ast, parseSelector(at)).length
    counted.set(at, hits)

    return hits
  }
}

Deno.bench('address every site in the three hardest fixtures', () => {
  for (const { indexed } of INDEXED) {
    const count = counter(indexed)
    for (const site of sites(indexed)) pin(indexed, site.node, count)
  }
})

// The count is the only thing pin spends, so this says how much of the above is esquery matching.
Deno.bench('address them again with every count already taken', () => {
  for (const { indexed } of INDEXED) {
    const count = counter(indexed)
    for (const site of sites(indexed)) pin(indexed, site.node, count)
    for (const site of sites(indexed)) pin(indexed, site.node, count)
  }
})

// What a plan pays end to end, which is the figure a run multiplies by its mutation count.
Deno.bench('stub a whole plan from source', () => {
  for (const name of HARDEST) {
    const { path, source } = read(name)
    stubPlan(source, path)
  }
})
