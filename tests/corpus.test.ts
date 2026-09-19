import { assert, assertEquals, assertGreaterOrEqual, assertLessOrEqual } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import { indexSource, matchesUniquely } from '../src/lib/walk.ts'
import { parseSelector, select } from '../src/lib/select.ts'
import { stubPlan } from '../src/lib/stub.ts'

const FIXTURES = fromFileUrl(new URL('./fixtures/', import.meta.url))

// The corpus runs simplest first, so a failure list read top to bottom says how far the ladder got.
const CORPUS = [
  '01-distinct-ops.ts',
  '02-excluded-sites.ts',
  '03-awkward-literals.ts',
  '04-typescript-kinds.ts',
  '05-http-handler.ts',
  '06-repeated-literals.ts',
  '07-loop-bodies.ts',
  '08-nested-identical.ts',
  '09-twins.ts',
  '10-triplets.ts',
  '11-deep-nesting.ts',
  '12-jsx-twins.tsx',
  '13-types-only.ts',
  '14-single-expression.ts',
  '15-empty.ts',
  '16-operand-shapes.ts',
] as const

type Fixture = {
  path: string
  source: string
}

const read = (name: string): Fixture => {
  const path = `${FIXTURES}${name}`
  return { path, source: Deno.readTextFileSync(path) }
}

const corpus = new Map<string, Fixture>(CORPUS.map((name) => [name, read(name)]))

const fixture = (name: string): Fixture => {
  const found = corpus.get(name)
  if (!found) throw new Error(`No fixture named ${name}`)

  return found
}

// Three sweeps ask the same question of one fixture, and stubbing runs the ladder over every site.
// Stubbing each fixture once and reading the result three times keeps the corpus affordable.
const stubs = new Map<string, ReturnType<typeof stubPlan>>()

const stubbed = (name: string): ReturnType<typeof stubPlan> => {
  const already = stubs.get(name)
  if (already) return already

  const found = fixture(name)
  const fresh = stubPlan(found.source, found.path)
  stubs.set(name, fresh)

  return fresh
}

// Today's measured split per fixture, so a regression fails while understood gaps do not block.
// addressed is a floor and skipped a ceiling, letting a generator fix pass without editing numbers.
const BASELINE: Record<string, { sites: number; addressed: number; skipped: number }> = {
  '01-distinct-ops.ts': { sites: 33, addressed: 33, skipped: 0 },
  '02-excluded-sites.ts': { sites: 11, addressed: 11, skipped: 0 },
  '03-awkward-literals.ts': { sites: 15, addressed: 15, skipped: 0 },
  '04-typescript-kinds.ts': { sites: 23, addressed: 23, skipped: 0 },
  '05-http-handler.ts': { sites: 46, addressed: 44, skipped: 2 },
  '06-repeated-literals.ts': { sites: 28, addressed: 23, skipped: 5 },
  '07-loop-bodies.ts': { sites: 9, addressed: 9, skipped: 0 },
  '08-nested-identical.ts': { sites: 23, addressed: 23, skipped: 0 },
  '09-twins.ts': { sites: 24, addressed: 24, skipped: 0 },
  '10-triplets.ts': { sites: 24, addressed: 24, skipped: 0 },
  '11-deep-nesting.ts': { sites: 34, addressed: 33, skipped: 1 },
  '12-jsx-twins.tsx': { sites: 7, addressed: 7, skipped: 0 },
  '13-types-only.ts': { sites: 0, addressed: 0, skipped: 0 },
  '14-single-expression.ts': { sites: 1, addressed: 1, skipped: 0 },
  '15-empty.ts': { sites: 0, addressed: 0, skipped: 0 },
  '16-operand-shapes.ts': { sites: 16, addressed: 16, skipped: 0 },
}

describe('All Corpus Tests', () => {
  describe('the round trip', () => {
    for (const name of CORPUS) {
      it(`resolves every selector it emitted for ${name} back to the node it came from`, () => {
        const found = fixture(name)
        const { mutations } = stubbed(name)

        for (const mutation of mutations) {
          const matches = select(found.source, found.path, mutation.at)

          assertEquals(matches.length, 1, `${mutation.at} matched ${matches.length}`)
          assertEquals(matches[0]?.text, mutation.was, `${mutation.at} named a different node`)
        }
      })
    }
  })

  describe('the agreement between matchesUniquely and select', () => {
    for (const name of CORPUS) {
      it(`judges uniqueness in ${name} the same way a full match does`, () => {
        const found = fixture(name)
        const indexed = indexSource(found.source, found.path)
        const { mutations } = stubbed(name)

        for (const mutation of mutations) {
          const selector = parseSelector(mutation.at)
          const peers = [...indexed.byType.values()].flat()
          const unique = peers.filter((node) => matchesUniquely(indexed, selector, node))

          assertEquals(unique.length, select(found.source, found.path, mutation.at).length, mutation.at)
        }
      })
    }
  })

  describe('the coverage ratchet', () => {
    for (const name of CORPUS) {
      it(`addresses at least as many sites in ${name} as it did when the baseline was taken`, () => {
        const expected = BASELINE[name]
        assert(expected, `No baseline recorded for ${name}`)

        const { mutations, skipped } = stubbed(name)

        assertEquals(mutations.length + skipped.length, expected.sites, 'the site count moved')
        assertGreaterOrEqual(mutations.length, expected.addressed, 'fewer sites addressed than before')
        assertLessOrEqual(skipped.length, expected.skipped, 'more sites skipped than before')
      })
    }
  })
})
