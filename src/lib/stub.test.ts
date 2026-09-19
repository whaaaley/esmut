import { assert, assertEquals, assertExists } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { indexSource } from './walk.ts'
import { matchAll } from './query.ts'
import { parseSelector, select } from './select.ts'
import type { Op } from './schema.ts'
import { pin } from './pin.ts'
import { shapeHash } from './shape.ts'
import { opsFor, sites, stubPlan } from './stub.ts'

const FIXTURES = fromFileUrl(new URL('../../tests/fixtures/', import.meta.url))

// The corpus runs simplest first, so a failure list read top to bottom says how far addressing got.
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

type Fixture = { path: string; source: string }

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

const parse = (name: string): { fixture: Fixture; indexed: ReturnType<typeof indexSource> } => {
  const found = fixture(name)
  return { fixture: found, indexed: indexSource(found.source, found.path) }
}

const text = (found: Fixture, node: TSESTree.Node): string => found.source.slice(node.range[0], node.range[1])

const nodesOfType = (name: string, type: string): TSESTree.Node[] => parse(name).indexed.byType.get(type) ?? []

const siteAt = (name: string, snippet: string): { node: TSESTree.Node; ops: Op[] } | undefined => {
  const { fixture: found, indexed } = parse(name)
  return sites(indexed).find((site) => text(found, site.node) === snippet)
}

describe('All Stub Tests', () => {
  describe('opsFor', () => {
    it('gives a branch the one op that reverses it', () => {
      // Arrange
      const [node] = nodesOfType('01-distinct-ops.ts', 'IfStatement')

      // Act & Assert
      assertEquals(node && opsFor(node, undefined), ['invert'])
    })

    it('gives a logical expression both drops as well as the invert', () => {
      // Arrange
      const [node] = nodesOfType('01-distinct-ops.ts', 'LogicalExpression')

      // Act & Assert
      assertEquals(node && opsFor(node, undefined), ['drop-left', 'drop-right', 'invert'])
    })

    it('gives a comparison an operator swap, since a boundary is where an off-by-one hides', () => {
      // Arrange
      const [node] = nodesOfType('01-distinct-ops.ts', 'BinaryExpression')

      // Act & Assert
      assertEquals(node && opsFor(node, undefined), ['operator', 'invert'])
    })

    it('offers empty beside value for a non-empty string, which are different failures', () => {
      // Arrange
      const node = nodesOfType('14-single-expression.ts', 'Literal')[0]
      const string = nodesOfType('03-awkward-literals.ts', 'Literal').find((literal) => (
        literal.type === 'Literal' && literal.value === 'ok'
      ))

      // Act & Assert: a number carries no empty form, a string does.
      assertEquals(node && opsFor(node, undefined), ['value'])
      assertEquals(string && opsFor(string, undefined), ['value', 'empty'])
    })

    // A collection is read through the key holding its contents, and a wrong key reads it as empty.
    // Asserting only the empty case cannot tell that apart: both answers are the same empty list.
    it('offers empty for a collection holding something and refuses one holding nothing', () => {
      // Arrange
      const filled = indexSource('export const some = [1]\nexport const one = { a: 1 }\n', 'some.ts')
      const bare = indexSource('export const none = []\nexport const bare = {}\n', 'none.ts')

      const first = (indexed: ReturnType<typeof indexSource>, type: string): TSESTree.Node | undefined => (
        (indexed.byType.get(type) ?? [])[0]
      )

      const filledArray = first(filled, 'ArrayExpression')
      const filledObject = first(filled, 'ObjectExpression')
      const bareArray = first(bare, 'ArrayExpression')
      const bareObject = first(bare, 'ObjectExpression')

      assertExists(filledArray)
      assertExists(filledObject)
      assertExists(bareArray)
      assertExists(bareObject)

      // Act & Assert
      assertEquals(opsFor(filledArray, undefined), ['empty'])
      assertEquals(opsFor(filledObject, undefined), ['empty'])
      assertEquals(opsFor(bareArray, undefined), [])
      assertEquals(opsFor(bareObject, undefined), [])
    })

    // A return is read through the key holding its value, and a wrong key reads it as bare.
    it('offers remove for a return carrying something and refuses a bare one', () => {
      // Arrange
      const carrying = indexSource('export const go = (): number => {\n  return 1\n}\n', 'go.ts')
      const bare = indexSource('export const stop = (): void => {\n  return\n}\n', 'stop.ts')

      const returned = (indexed: ReturnType<typeof indexSource>): TSESTree.Node | undefined => (
        (indexed.byType.get('ReturnStatement') ?? [])[0]
      )

      const carried = returned(carrying)
      const empty = returned(bare)

      assertExists(carried)
      assertExists(empty)

      // Act & Assert
      assertEquals(opsFor(carried, undefined), ['remove'])
      assertEquals(opsFor(empty, undefined), [])
    })

    // Only a negation is a guard to reverse; typeof or minus merely happens to be unary.
    // Inverting one of those would emit !(typeof a), which tests nothing the author named.
    it('inverts a negation and no other unary operator', () => {
      // Arrange
      const unary = (source: string): TSESTree.Node | undefined => (
        (indexSource(source, 'x.ts').byType.get('UnaryExpression') ?? [])[0]
      )

      const negation = unary('const b = !a\n')
      const typeOf = unary('const b = typeof a\n')
      const minus = unary('const b = -a\n')

      assertExists(negation)
      assertExists(typeOf)
      assertExists(minus)

      // Act & Assert
      assertEquals(opsFor(negation, undefined), ['invert'])
      assertEquals(opsFor(typeOf, undefined), [])
      assertEquals(opsFor(minus, undefined), [])
    })

    it('names no op for a node no mutation applies to', () => {
      // Arrange
      const [node] = nodesOfType('01-distinct-ops.ts', 'Identifier')

      // Act & Assert
      assertEquals(node && opsFor(node, undefined), [])
    })
  })

  describe('sites', () => {
    it('reports sites in source order, so a plan reads down the file', () => {
      // Arrange
      const { indexed } = parse('05-http-handler.ts')

      // Act
      const found = sites(indexed)

      // Assert
      const starts = found.map((site) => site.node.range[0])
      assertEquals(starts, [...starts].sort((left, right) => left - right))
    })

    it('excludes a message string, since what a log carries is description rather than behavior', () => {
      // Act & Assert
      assertEquals(siteAt('02-excluded-sites.ts', "'writing the cache to disk'"), undefined)
    })

    it('excludes what an error carries, for the same reason a log is excluded', () => {
      // Act & Assert
      assertEquals(siteAt('02-excluded-sites.ts', "'too many attempts while writing the cache'"), undefined)
    })

    it('excludes an import specifier, which tests the resolver rather than the code', () => {
      // Act & Assert
      assertEquals(siteAt('02-excluded-sites.ts', "'@std/path'"), undefined)
    })

    it('excludes a property key, since renaming one is a change the compiler refuses', () => {
      // Arrange
      const { fixture: found, indexed } = parse('02-excluded-sites.ts')

      // Act: the key mode is excluded while the value beside it stays.
      const strings = sites(indexed).filter((site) => site.node.type === 'Literal')
      const literals = strings.map((site) => text(found, site.node))

      // Assert
      assert(literals.includes("'append'"), 'the value of a property is a site')
      assertEquals(literals.filter((literal) => literal === 'mode'), [])
    })

    it('keeps a config literal, since a rule that guessed at intent would sometimes guess wrong', () => {
      // Act & Assert
      assert(siteAt('02-excluded-sites.ts', '2'), 'a config number is still a site')
    })

    // console is one of three loggers a codebase reaches for, and a rule naming only it misses two.
    it('excludes what any of the loggers carries, not only console', () => {
      // Arrange
      const source = "log.warn('a message')\nlogger.info('another')\nconsole.error('a third')\n"
      const indexed = indexSource(source, 'logging.ts')

      // Act
      const literals = sites(indexed).filter((site) => site.node.type === 'Literal')

      // Assert
      assertEquals(literals, [])
    })

    // The rule reads the suffix rather than the whole name, so a project's own error type is out.
    // A constructor not ending in Error carries a value rather than a message, so it stays a site.
    it('excludes what a named error carries and keeps what any other constructor does', () => {
      // Arrange
      const source = "const a = new CliError('a refusal')\nconst b = new Response('a body')\n"
      const indexed = indexSource(source, 'refusing.ts')

      // Act
      const literals = sites(indexed)
        .filter((site) => site.node.type === 'Literal')
        .map((site) => source.slice(site.node.range[0], site.node.range[1]))

      // Assert
      assertEquals(literals, ["'a body'"])
    })

    it('finds no site in a file the type checker erases entirely', () => {
      // Act & Assert
      assertEquals(sites(parse('13-types-only.ts').indexed).length, 0)
    })

    it('finds no site in an empty file rather than failing to walk it', () => {
      // Act & Assert
      assertEquals(sites(parse('15-empty.ts').indexed).length, 0)
    })
  })

  describe('pin', () => {
    // The counter is the only thing pin asks about a selector, so the tests drive the real matcher.
    const counter = (indexed: ReturnType<typeof indexSource>) => (at: string): number => (
      matchAll(indexed.ast, parseSelector(at)).length
    )

    const addressOf = (name: string, snippet: string): { at: string; matches: number; found: Fixture } => {
      const { fixture: found, indexed } = parse(name)
      const site = sites(indexed).find((candidate) => text(found, candidate.node) === snippet)

      if (!site) throw new Error(`No site reading ${snippet} in ${name}`)

      return { ...pin(indexed, site.node, counter(indexed)), found }
    }

    it('names a node by its own content rather than by the scopes above it', () => {
      // Arrange, Act
      const { at, matches, found } = addressOf('14-single-expression.ts', '42')

      // Assert
      assertEquals(at, 'Literal[value=42]')
      assertEquals(matches, 1)
      assertEquals(select(found.source, found.path, at).length, 1)
    })

    // A path step carries a position only where its key holds a list, so a ternary's two sides
    // would tie on the path alone and the field selector is the only thing separating them.
    it('names the field a node sits under where the key holds one child', () => {
      // Arrange
      const twins = indexSource('const f = (v: string): string[] => v ? [] : []\n', 'twins.ts')
      const [consequent, alternate] = twins.byType.get('ArrayExpression') ?? []

      if (!consequent || !alternate) throw new Error('the ternary must hold two arrays')

      // Act
      const first = pin(twins, consequent, counter(twins))
      const second = pin(twins, alternate, counter(twins))

      // Assert: both are empty and positionless, so nothing but the field tells them apart.
      assertEquals(first.matches, 1)
      assertEquals(second.matches, 1)
      assert(first.at.endsWith('.consequent'), `${first.at} must name its field`)
      assert(second.at.endsWith('.alternate'), `${second.at} must name its field`)
    })

    it('resolves a comparison whose operand reads a property', () => {
      // Arrange, Act
      const { at, matches, found } = addressOf('16-operand-shapes.ts', "target.type === 'UnaryExpression'")

      // Assert
      assertEquals(matches, 1)
      assertEquals(select(found.source, found.path, at).length, 1)
    })

    // A deeply nested node once exhausted a budget, where a computed address never searches.
    it('resolves a deeply nested comparison without naming the scopes above it', () => {
      // Arrange, Act
      const { at, matches, found } = addressOf('11-deep-nesting.ts', 'depth > 9')

      // Assert
      assertEquals(at, 'BinaryExpression[right.value=9]')
      assertEquals(matches, 1)
      assertEquals(select(found.source, found.path, at).length, 1)
    })

    // Three identical objects at three depths share content, so only the path separates them.
    it('falls back to the path where every peer carries the same content', () => {
      // Arrange, Act
      const { at, matches, found } = addressOf('08-nested-identical.ts', '{ attempts: 2, backoff: 100 }')

      // Assert
      assertEquals(matches, 1)
      assert(at.includes(' > '), `${at} must name a path, since content ties`)
      assertEquals(select(found.source, found.path, at).length, 1)
    })

    it('resolves every site in every fixture, so no site is left without an address', () => {
      // Arrange
      const unresolved: string[] = []

      // Act
      for (const name of CORPUS) {
        const { fixture: found, indexed } = parse(name)
        const count = counter(indexed)

        for (const site of sites(indexed)) {
          const { at, matches } = pin(indexed, site.node, count)
          const hits = select(found.source, found.path, at)
          const right = matches === 1 && hits.length === 1 && hits[0]?.range[0] === site.node.range[0]

          if (!right) unresolved.push(`${name}:${site.node.loc.start.line} ${site.node.type} ${at}`)
        }
      }

      // Assert
      assertEquals(unresolved, [])
    })
  })

  describe('stubPlan', () => {
    it('leaves op null, since the tool locates a site but cannot say which mutation means something', () => {
      // Arrange
      const found = fixture('14-single-expression.ts')

      // Act
      const { mutations } = stubPlan(found.source, found.path)

      // Assert
      assertEquals(mutations.map((mutation) => mutation.op), [null])
    })

    // The structure is recorded rather than the source, so a later drift report names a real change.
    it('records the structure of the node it addressed', () => {
      // Arrange
      const found = fixture('14-single-expression.ts')
      const { indexed } = parse('14-single-expression.ts')
      const [literal] = indexed.byType.get('Literal') ?? []

      // Act
      const { mutations } = stubPlan(found.source, found.path)

      // Assert
      assertExists(literal)
      assertEquals(mutations[0]?.shape, shapeHash(literal))
    })

    // Every site gets an address, so a plan never carries an empty selector or leaves a site out.
    it('addresses every site of a fixture written to repeat one value', () => {
      // Arrange
      const found = fixture('06-repeated-literals.ts')
      const { indexed } = parse('06-repeated-literals.ts')

      // Act
      const { mutations } = stubPlan(found.source, found.path)

      // Assert
      assertEquals(mutations.length, sites(indexed).length)
      assertEquals(mutations.some((mutation) => mutation.at === ''), false)
    })

    it('reads an empty file without failing to walk it', () => {
      // Arrange
      const found = fixture('15-empty.ts')

      // Act
      const stubbed = stubPlan(found.source, found.path)

      // Assert
      assertEquals(stubbed, { mutations: [] })
    })

    it('reaches a site under a TS-only kind, which is unreachable without the visitor keys', () => {
      // Arrange
      const found = fixture('04-typescript-kinds.ts')

      // Act
      const { mutations } = stubPlan(found.source, found.path)

      // Assert: the literal inside the generic is named, which no default visitor key reaches.
      const reached = mutations.some((mutation) => mutation.at.includes("'over the ceiling'"))
      assert(reached, 'a site inside a generic is reachable')
    })

    it('parses jsx for a tsx path, so an element is walked rather than refused', () => {
      // Arrange
      const found = fixture('12-jsx-twins.tsx')

      // Act
      const { mutations } = stubPlan(found.source, found.path)

      // Assert
      assert(mutations.some((mutation) => mutation.at.includes("'active'")), 'a jsx attribute value is a site')
    })
  })
})
