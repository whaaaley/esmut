import { fromFileUrl } from '@std/path'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { parseSelector } from './select.ts'
import { address, candidates, sites } from './stub.ts'
import { indexSource, matchesUniquely } from './walk.ts'

// Stubbing the corpus is what makes stub.test.ts and corpus.test.ts the two slowest suites,
// and those two are the cmd of the two slowest plans, so this is the cost a run multiplies.
const FIXTURES = fromFileUrl(new URL('../../tests/fixtures/', import.meta.url))

const read = (name: string): { path: string; source: string } => {
  const path = `${FIXTURES}${name}`
  return { path, source: Deno.readTextFileSync(path) }
}

// The three the ladder spends its budget on, since each is built to resist a short address.
// A fixture that addresses on the first tier says nothing about what a run waits for.
const HARDEST = ['11-deep-nesting.ts', '05-http-handler.ts', '06-repeated-literals.ts']

const INDEXED = HARDEST.map((name) => {
  const { path, source } = read(name)
  return { name, indexed: indexSource(source, path) }
})

Deno.bench('address every site in the three hardest fixtures', () => {
  for (const { indexed } of INDEXED) {
    for (const site of sites(indexed)) address(indexed, site.node)
  }
})

type Tried = {
  node: TSESTree.Node
  at: string
}

// The candidates one fixture's sites try, collected once so the two benches below share them.
// Measuring the parse inside the match bench would report their sum rather than either one.
const collect = (): Tried[] => {
  const collected: Tried[] = []
  const first = INDEXED[0]

  if (!first) return collected

  for (const site of sites(first.indexed)) {
    let tried = 0

    for (const at of candidates(first.indexed, site.node)) {
      if (tried >= 200) break
      tried += 1

      collected.push({ node: site.node, at })
    }
  }

  return collected
}

const TRIED = collect()

const PARSED = TRIED.map((entry) => ({ ...entry, selector: parseSelector(entry.at) }))

// The ladder pays two costs per candidate, and these say which one to attack.
// parseSelector is pure and its inputs repeat across sites, where matchesUniquely reads the tree.
Deno.bench('parseSelector over the candidates one fixture tries', () => {
  for (const { at } of TRIED) parseSelector(at)
})

Deno.bench('matchesUniquely over the same candidates, already parsed', () => {
  const base = INDEXED[0]
  if (!base) return

  for (const { selector, node } of PARSED) matchesUniquely(base.indexed, selector, node)
})
