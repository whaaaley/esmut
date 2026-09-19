import { assert, assertEquals, assertExists } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import { indexSource, matchesUniquely } from '../src/lib/walk.ts'
import { parseSelector, select } from '../src/lib/select.ts'
import { shapeHash } from '../src/lib/shape.ts'
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
  '17-template-statements.ts',
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

// How many sites each fixture holds, which every one of them is addressed by.
// The count moving means the walk or the op set changed, which is a thing to look at rather than
// a number to raise, so it is asserted exactly rather than as a floor.
const SITES: Record<string, number> = {
  '01-distinct-ops.ts': 33,
  '02-excluded-sites.ts': 11,
  '03-awkward-literals.ts': 15,
  '04-typescript-kinds.ts': 23,
  '05-http-handler.ts': 46,
  '06-repeated-literals.ts': 28,
  '07-loop-bodies.ts': 9,
  '08-nested-identical.ts': 23,
  '09-twins.ts': 24,
  '10-triplets.ts': 24,
  '11-deep-nesting.ts': 34,
  '12-jsx-twins.tsx': 7,
  '13-types-only.ts': 0,
  '14-single-expression.ts': 1,
  '15-empty.ts': 0,
  '16-operand-shapes.ts': 16,
  '17-template-statements.ts': 7,
}

describe('All Corpus Tests', () => {
  describe('the round trip', () => {
    for (const name of CORPUS) {
      it(`resolves every selector it emitted for ${name} back to the node it came from`, () => {
        const found = fixture(name)
        const { mutations } = stubbed(name)

        const indexed = indexSource(found.source, found.path)

        for (const mutation of mutations) {
          const matches = select(found.source, found.path, mutation.at)
          const [first] = matches

          assertEquals(matches.length, 1, `${mutation.at} matched ${matches.length}`)

          // The node the selector reaches must be the one the shape was taken from, not merely one
          // node, so the structure at that range is what the recorded shape is compared against.
          const reached = (indexed.byType.get(first?.type ?? '') ?? []).find((node) => node.range[0] === first?.range[0])

          assertExists(reached, `${mutation.at} reached no indexed node`)
          assertEquals(shapeHash(reached), mutation.shape, `${mutation.at} named a different node`)
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

  describe('the coverage floor', () => {
    for (const name of CORPUS) {
      it(`addresses every site in ${name}, leaving none without a selector`, () => {
        const expected = SITES[name]
        assert(expected !== undefined, `No site count recorded for ${name}`)

        const { mutations } = stubbed(name)

        assertEquals(mutations.length, expected, 'the site count moved')
        assertEquals(mutations.filter((mutation) => mutation.at === '').length, 0, 'a mutation carries no selector')
      })
    }
  })
})
