import { assert, assertEquals, assertExists } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import type { TSESTree } from '@typescript-eslint/typescript-estree'
import { indexSource } from './walk.ts'
import { parseSelector, select } from './select.ts'
import type { Op } from './schema.ts'
import { address, candidates, opsFor, sites, stubPlan } from './stub.ts'

const FIXTURES = fromFileUrl(new URL('../../tests/fixtures/', import.meta.url))

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

// Reads the first few of a generator, since a candidate ladder is unbounded but its head matters.
function* take<T>(values: Iterable<T>, count: number): Generator<T> {
  let taken = 0

  for (const value of values) {
    if (taken >= count) return
    taken += 1

    yield value
  }
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

  describe('candidates', () => {
    it('offers the bare type first, so the shortest selector that works is the one kept', () => {
      // Arrange
      const { indexed } = parse('14-single-expression.ts')
      const [node] = indexed.byType.get('Literal') ?? []

      // Act
      const [first] = node ? [...take(candidates(indexed, node), 1)] : []

      // Assert
      assertEquals(first, 'Literal')
    })

    it('escapes a quote and a backslash, so the selector it emits still parses', () => {
      // Arrange
      const { fixture: found, indexed } = parse('03-awkward-literals.ts')
      const node = (indexed.byType.get('Literal') ?? []).find((literal) => text(found, literal).includes("quote ' and"))

      // Act
      const offered = node ? [...take(candidates(indexed, node), 40)] : []

      // Assert: every candidate must survive the parser, which is what a bad escape breaks.
      for (const candidate of offered) parseSelector(candidate)

      // Parsing is not enough: a mangled escape still parses while naming a literal the file lacks.
      // The ladder offers candidates matching nothing by design, so the chosen one must resolve.
      const chosen = node ? address(indexed, node) : null

      assert(chosen, 'the literal is addressable')
      assert(chosen?.includes('[value='), 'the address carries the literal it names')
      assertEquals(select(found.source, found.path, chosen ?? '').length, 1)
    })

    // A backslash in a literal is a character the selector language also reads, so it must survive.
    it('emits a selector that still finds a literal holding a backslash', () => {
      // Arrange: two literals, so the bare type is ambiguous and the value attribute separates.
      const source = `const path = 'a\\\\b'\nconst other = 'plain'\n`
      const indexed = indexSource(source, 'escaping.ts')
      const literal = (indexed.byType.get('Literal') ?? []).find((node) => (
        source.slice(node.range[0], node.range[1]).includes('\\\\')
      ))

      // Act
      const chosen = literal ? address(indexed, literal) : null

      // Assert: the address is what a plan carries, so it is the one that must find the node again.
      assert(chosen?.includes('[value='), 'the address carries the literal it names')
      assertEquals(select(source, 'escaping.ts', chosen ?? '').length, 1)
    })

    // A value attribute carries the literal into the selector, and a long one makes it unreadable.
    // The cap keeps a selector something a person can check, and a plan is read as well as run.
    it('offers a value attribute for a short literal and withholds it for a long one', () => {
      // Arrange
      const short = indexSource("const a = 'ok'\n", 'x.ts')
      const long = indexSource(`const a = '${'x'.repeat(41)}'\n`, 'x.ts')

      const literal = (indexed: ReturnType<typeof indexSource>): TSESTree.Node => {
        const [node] = indexed.byType.get('Literal') ?? []
        if (!node) throw new Error('No literal in the source')

        return node
      }

      // Act
      const offered = [...take(candidates(short, literal(short)), 6)]
      const withheld = [...take(candidates(long, literal(long)), 6)]

      // Assert
      assert(offered.some((candidate) => candidate.includes("[value='ok']")), 'a short value is named')
      assert(!withheld.some((candidate) => candidate.includes('[value=')), 'a long value is not named')
    })

    // A bait tells one ancestor from an identical sibling, so the literal must be distinctive.
    // Three characters distinguishes nothing, and past forty the selector is unreadable.
    it('baits an ancestor with a literal long enough to distinguish it and short enough to read', () => {
      // Arrange
      const guard = (marker: string): ReturnType<typeof indexSource> => (
        indexSource(`const f = (): void => {\n  if (a) go('${marker}')\n}\n`, 'x.ts')
      )

      const baitsFor = (indexed: ReturnType<typeof indexSource>): string[] => {
        const target = (indexed.byType.get('Identifier') ?? []).find((node) => (
          indexed.ancestry.get(node)?.some((parent) => parent.type === 'IfStatement')
        ))

        if (!target) throw new Error('No identifier under a guard')

        return [...take(candidates(indexed, target), 200)].filter((candidate) => candidate.includes(':has('))
      }

      // Act & Assert
      assert(baitsFor(guard('abcd')).length > 0, 'four characters is distinctive enough to bait with')
      assertEquals(baitsFor(guard('abc')).length, 0)
      assertEquals(baitsFor(guard('z'.repeat(41))).length, 0)
    })

    // A selector reads outermost first, so each scope in a chain sits further up than the next.
    // A bound letting a scope pair with itself emits X X Self, which names nothing in the tree.
    it('draws each scope from further up the ancestry than the one after it', () => {
      // Arrange
      const { indexed } = parse('09-twins.ts')
      const [node] = indexed.byType.get('CatchClause') ?? []

      // Act
      const offered = node ? [...take(candidates(indexed, node), 400)] : []

      // Assert
      assert(offered.length > 0, 'the twin fixture offers candidates to check')

      for (const candidate of offered) {
        const parts = candidate.split(/\s+>?\s*/).filter(Boolean)
        const repeated = parts.find((part, index) => index > 0 && part === parts[index - 1])

        assertEquals(repeated, undefined, `${candidate} repeats a scope`)
      }
    })

    it('names one concrete type at its rightmost compound, which is what the by-type check relies on', () => {
      // Arrange
      const { indexed } = parse('09-twins.ts')
      const nodes = [...indexed.byType.values()].flat()

      // Act & Assert: a rightmost :matches or :not spans types and silently breaks matchesUniquely.
      for (const node of nodes.slice(0, 40)) {
        for (const candidate of take(candidates(indexed, node), 30)) {
          const rightmost = candidate.split(/[\s>]+/).filter(Boolean).at(-1) ?? ''
          assert(rightmost.startsWith(node.type), `${candidate} must end in ${node.type}`)
        }
      }
    })
  })

  // Each attribute reads a different field, and a wrong field name yields a selector naming none.
  // The ladder then falls through to a longer candidate, which the addressing rate hides.
  it('names the method a call reaches and the binding a comparison reads', () => {
    // Arrange
    const source = "const ok = headers.get('x') === wanted\n"
    const indexed = indexSource(source, 'calling.ts')
    const [call] = indexed.byType.get('CallExpression') ?? []
    const [binary] = indexed.byType.get('BinaryExpression') ?? []

    // Act
    const forCall = call ? [...take(candidates(indexed, call), 12)] : []
    const forBinary = binary ? [...take(candidates(indexed, binary), 12)] : []

    // Assert
    assert(forCall.includes("CallExpression[callee.property.name='get']"), 'the method a call reaches')
    assert(forBinary.includes("BinaryExpression[right.name='wanted']"), 'the binding on the right')
  })

  // A declarator names its binding through id, the anchor that tells one twin from another.
  it('names the binding a scope declares, which is what separates two twins', () => {
    // Arrange
    const source = 'const safe = () => {\n  return 1\n}\n'
    const indexed = indexSource(source, 'twins.ts')
    const [returning] = indexed.byType.get('ReturnStatement') ?? []

    // Act
    const offered = returning ? [...take(candidates(indexed, returning), 40)] : []

    // Assert
    assert(offered.some((one) => one.includes("VariableDeclarator[id.name='safe']")), 'the declared binding')
  })

  describe('address', () => {
    it('addresses a lone node by its bare type rather than reaching for a scope', () => {
      // Arrange
      const { indexed } = parse('14-single-expression.ts')
      const [node] = indexed.byType.get('Literal') ?? []

      // Act & Assert
      assertEquals(node && address(indexed, node), 'Literal')
    })

    it('names the enclosing binding to tell one twin from the other', () => {
      // Arrange
      const { fixture: found, indexed } = parse('09-twins.ts')
      const node = (indexed.byType.get('CatchClause') ?? [])[0]

      // Act
      const at = node ? address(indexed, node) : null

      // Assert: the declarator is the only thing separating the two bodies.
      assert(at?.includes("[id.name='attempt']"), `${at} must name the binding it sits in`)
      assertEquals(select(found.source, found.path, at ?? '').length, 1)
    })

    // A node this deep once exhausted the budget inside the scope tiers, since every scope above it
    // repeats. The literal it compares against sits on the node itself, so no scope is needed at all.
    it('addresses a deeply nested comparison by its own operand rather than by the scopes above it', () => {
      // Arrange
      const { fixture: found, indexed } = parse('11-deep-nesting.ts')
      const binaries = indexed.byType.get('BinaryExpression') ?? []
      const node = binaries.find((binary) => text(found, binary) === 'depth > 9')

      // Act
      const at = node ? address(indexed, node) : null

      // Assert
      assertEquals(at, 'BinaryExpression[right.value=9]')
      assertEquals(select(found.source, found.path, at ?? '').length, 1)
    })

    // Two comparisons under one declarator at one depth share operator, depth, and bait literal.
    // Which binding each reads is the only separating fact, so the operand attribute settles it.
    it('names the operand a comparison reads, which is the only fact separating it from its neighbour', () => {
      // Arrange
      const { fixture: found, indexed } = parse('06-repeated-literals.ts')
      const binaries = indexed.byType.get('BinaryExpression') ?? []
      const node = binaries.find((binary) => text(found, binary) === "name === 'help'")

      // Act
      const found_at = node ? address(indexed, node) : null

      // Assert
      assertEquals(found_at, "BinaryExpression[left.name='name']")
      assertEquals(select(found.source, found.path, "BinaryExpression[left.name='name']").length, 1)
    })

    // An operand that is a member expression carries no name, so the name attributes describe nothing.
    // The property it reads is the separating fact, and without it two comparisons go unaddressed.
    it('names the property an operand reads where the operand is not a bare binding', () => {
      // Arrange
      const { fixture: found, indexed } = parse('16-operand-shapes.ts')
      const binaries = indexed.byType.get('BinaryExpression') ?? []
      const node = binaries.find((binary) => text(found, binary) === "target.type === 'UnaryExpression'")

      // Act
      const at = node ? address(indexed, node) : null

      // Assert
      assertExists(at, 'a comparison reading target.type must be addressable')
      assertEquals(select(found.source, found.path, at).length, 1)
    })

    // The right operand is a literal, which carries a value rather than a name or a property.
    it('names the literal an operand compares against where the other side repeats', () => {
      // Arrange
      const { fixture: found, indexed } = parse('16-operand-shapes.ts')
      const binaries = indexed.byType.get('BinaryExpression') ?? []
      const node = binaries.find((binary) => text(found, binary) === "target.operator === '!'")

      // Act
      const at = node ? address(indexed, node) : null

      // Assert
      assertExists(at, 'a comparison reading target.operator must be addressable')
      assertEquals(select(found.source, found.path, at).length, 1)
    })

    // A template's fixed text is the only thing separating these, and it sits under TemplateElement
    // rather than on a Literal, so a bait that reads only literals describes none of them.
    it('names the fixed text of a template where that is the only separating fact', () => {
      // Arrange
      const { fixture: found, indexed } = parse('17-template-statements.ts')
      const templates = indexed.byType.get('TemplateLiteral') ?? []
      const node = templates.find((template) => text(found, template).includes('carries no condition'))

      // Act
      const at = node ? address(indexed, node) : null

      // Assert
      assertExists(at, 'a template carrying distinct text must be addressable')
      assertEquals(select(found.source, found.path, at).length, 1)
    })
  })

  describe('the budget', () => {
    // The budget stops the ladder searching forever, set where the hardest real site lands.
    // A site in the http fixture needs all of it, so lowering it costs addresses, not just time.
    it('addresses fewer sites when the search is cut short', () => {
      // Arrange
      const { indexed } = parse('05-http-handler.ts')
      const found = sites(indexed)

      // Act
      const generous = found.filter((site) => address(indexed, site.node) !== null).length
      const stingy = found.filter((site) => address(indexed, site.node, 40) !== null).length

      // Assert
      assert(stingy < generous, 'a smaller budget reaches fewer sites')
      assertEquals(generous, 44)
    })

    // A bait is a literal under an ancestor.
    // The cap is how many one ancestor contributes before the ladder moves on.
    // Capping at one costs an address in the corpus, so the number is load-bearing, not a default.
    it('offers more than one bait for an ancestor carrying several literals', () => {
      // Arrange
      const source = "const go = (): string => {\n  if (mode === 'fast') return 'quick'\n  return 'slow'\n}\n"
      const indexed = indexSource(source, 'baiting.ts')
      const [branch] = indexed.byType.get('IfStatement') ?? []
      const [returning] = indexed.byType.get('ReturnStatement') ?? []

      // Act
      const offered = returning ? [...take(candidates(indexed, returning), 80)] : []
      const baited = offered.filter((one) => one.includes(':has(Literal'))

      // Assert
      assert(branch, 'the fixture carries a branch to bait')
      assert(new Set(baited).size > 1, 'an ancestor with several literals offers more than one bait')
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

    it('records what the node read as, so a later stale report can name it', () => {
      // Arrange
      const found = fixture('14-single-expression.ts')

      // Act
      const { mutations } = stubPlan(found.source, found.path)

      // Assert
      assertEquals(mutations[0]?.was, '42')
    })

    it('carries an unaddressable site into skipped with the ops it would have taken', () => {
      // Arrange
      const found = fixture('06-repeated-literals.ts')

      // Act
      const { mutations, skipped } = stubPlan(found.source, found.path)

      // Assert: a skipped entry keeps a position so an author can hand-write an anchor for it.
      assert(skipped.length > 0, 'the repeated-literal fixture has sites the ladder cannot reach')
      assertEquals(skipped.every((entry) => entry.ops.length > 0 && entry.line > 0), true)
      assertEquals(mutations.some((mutation) => mutation.at === ''), false)
    })

    it('reads an empty file without failing to walk it', () => {
      // Arrange
      const found = fixture('15-empty.ts')

      // Act
      const stubbed = stubPlan(found.source, found.path)

      // Assert
      assertEquals(stubbed, { mutations: [], skipped: [] })
    })

    it('reaches a site under a TS-only kind, which is unreachable without the visitor keys', () => {
      // Arrange
      const found = fixture('04-typescript-kinds.ts')

      // Act
      const { mutations, skipped } = stubPlan(found.source, found.path)

      // Assert: an unreachable node reads as stale, so every site here must be addressed.
      assertEquals(skipped.length, 0)
      const reached = mutations.some((mutation) => mutation.was === "'over the ceiling'")
      assert(reached, 'a site inside a generic is reachable')
    })

    it('parses jsx for a tsx path, so an element is walked rather than refused', () => {
      // Arrange
      const found = fixture('12-jsx-twins.tsx')

      // Act
      const { mutations, skipped } = stubPlan(found.source, found.path)

      // Assert
      assertEquals(skipped.length, 0)
      assert(mutations.some((mutation) => mutation.was === "'active'"), 'a jsx attribute value is a site')
    })
  })
})
