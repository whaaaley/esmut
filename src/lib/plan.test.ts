import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from '@std/assert'
import { describe, it } from 'node:test'
import { assertResolves, assertRunnable, mergePlan, planPath, readPlan, writePlan } from './plan.ts'
import { CliError } from '../utils/error.utils.ts'
import type { Plan } from './schema.ts'
import type { Stubbed } from './stub.ts'

const plan = (mutations: Plan['mutations'], cmd = 'deno task test'): Plan => ({ source: 'src/a.ts', cmd, mutations })

const stubbed = (mutations: Stubbed['mutations']): Stubbed => ({ mutations })

describe('All Plan Tests', () => {
  describe('planPath', () => {
    // A plan records intent rather than code, so it sits in one directory, not beside each source.
    it('names the plan under .esmut rather than beside the source', () => {
      // Act & Assert
      assertEquals(planPath('src/lib/stub.ts'), '.esmut/lib.stub.json')
      assertEquals(planPath('src/esmut.ts'), '.esmut/esmut.json')
    })

    // Two sources can share a basename, so the name carries its path and they do not collide.
    it('carries the path into the name, so two sources sharing a basename differ', () => {
      // Act & Assert
      assertEquals(planPath('src/lib/run.ts'), '.esmut/lib.run.json')
      assertEquals(planPath('src/cmds/run.ts'), '.esmut/cmds.run.json')
    })

    it('takes off only the final extension, so a dotted stem survives', () => {
      // Act & Assert
      assertEquals(planPath('src/a.test.ts'), '.esmut/a.test.json')
      assertEquals(planPath('src/utils/safe.utils.ts'), '.esmut/utils.safe.utils.json')
    })
  })

  describe('mergePlan', () => {
    it('keeps the op an author chose, which is the judgment a fresh stub cannot derive', () => {
      // Arrange
      const name = 'the boundary is never tested'
      const existing = plan([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: 'value', to: '2', name }])

      // Act
      const merged = mergePlan(existing, stubbed([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: null }]), 'src/a.ts')

      // Assert: op, to, and name are the only fields carrying human judgment.
      assertEquals(merged.plan.mutations[0]?.op, 'value')
      assertEquals(merged.plan.mutations[0]?.to, '2')
      assertEquals(merged.plan.mutations[0]?.name, 'the boundary is never tested')
      assertEquals(merged.kept, 1)
    })

    // An entry nobody filled is a site waiting on an op, so the one the stub derived is written.
    // The alternative leaves a plan that cannot run until someone fills every entry by hand.
    it('fills an entry nobody chose an op for from the one the stub derived', () => {
      // Arrange
      const existing = plan([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: null }])
      const found = stubbed([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: 'value', to: '0' }])

      // Act
      const merged = mergePlan(existing, found, 'src/a.ts')

      // Assert
      assertEquals(merged.plan.mutations[0]?.op, 'value')
      assertEquals(merged.plan.mutations[0]?.to, '0')
    })

    // A derived op is a guess, so the plan says so rather than reading as an author's judgment.
    it('marks a plan whose ops the stub derived, and leaves one it did not alone', () => {
      // Arrange
      const unfilled = plan([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: null }])
      const chosen = plan([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: 'value', to: '2' }])
      const found = stubbed([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: 'value', to: '0' }])

      // Act
      const derived = mergePlan(unfilled, found, 'src/a.ts')
      const judged = mergePlan(chosen, found, 'src/a.ts')

      // Assert: the marker follows whether the stub supplied an op, not whether one is present.
      assertEquals(derived.plan.filledBy, 'stub')
      assertEquals(judged.plan.filledBy, undefined)
    })

    // sweep records itself, and a later stub must not relabel that plan as its own guess.
    it('leaves a marker an earlier fill wrote rather than claiming the plan', () => {
      // Arrange
      const swept: Plan = { ...plan([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: null }]), filledBy: 'sweep' }
      const found = stubbed([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: 'value', to: '0' }])

      // Act
      const merged = mergePlan(swept, found, 'src/a.ts')

      // Assert
      assertEquals(merged.plan.filledBy, 'sweep')
    })

    it('refreshes the structure it recorded, so a later drift report is honest about it', () => {
      // Arrange
      const existing = plan([{ at: 'Literal[value=1]', shape: 'deadbeef', op: 'value', to: '2' }])

      // Act
      const merged = mergePlan(existing, stubbed([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: null }]), 'src/a.ts')

      // Assert
      assertEquals(merged.plan.mutations[0]?.shape, 'aaaa1111')
    })

    it('appends a site the stub newly found, after the entries already written', () => {
      // Arrange
      const existing = plan([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: 'value', to: '2' }])
      const found = stubbed([
        { at: 'Literal[value=1]', shape: 'aaaa1111', op: null },
        { at: 'Literal[value=9]', shape: 'cccc9999', op: null },
      ])

      // Act
      const merged = mergePlan(existing, found, 'src/a.ts')

      // Assert
      assertEquals(merged.plan.mutations.map((mutation) => mutation.at), ['Literal[value=1]', 'Literal[value=9]'])
      assertEquals([merged.kept, merged.added], [1, 1])
    })

    it('preserves an entry whose selector no longer resolves and reports it as stale', () => {
      // Arrange
      const name = 'the retry cap is never tested'
      const existing = plan([{ at: 'Literal[value=7]', shape: 'bbbb7777', op: 'value', to: '8', name }])

      // Act
      const merged = mergePlan(existing, stubbed([{ at: 'Literal[value=1]', shape: 'aaaa1111', op: null }]), 'src/a.ts')

      // Assert: a stale address means the source moved, not that the behavior stopped mattering.
      assertEquals(merged.stale.map((mutation) => mutation.at), ['Literal[value=7]'])
      assertEquals(merged.plan.mutations.length, 2)
      assertEquals(merged.plan.mutations[0]?.name, 'the retry cap is never tested')
      assertEquals(merged.kept, 0)
    })

    it('orders the plan kept, then stale, then added, so a re-stub does not reshuffle it', () => {
      // Arrange
      const existing = plan([
        { at: 'Literal[value=1]', shape: 'aaaa1111', op: 'value', to: '2' },
        { at: 'Literal[value=7]', shape: 'bbbb7777', op: 'value', to: '8' },
      ])
      const found = stubbed([
        { at: 'Literal[value=1]', shape: 'aaaa1111', op: null },
        { at: 'Literal[value=9]', shape: 'cccc9999', op: null },
      ])

      // Act
      const merged = mergePlan(existing, found, 'src/a.ts')

      // Assert
      assertEquals(merged.plan.mutations.map((mutation) => mutation.at), [
        'Literal[value=1]',
        'Literal[value=7]',
        'Literal[value=9]',
      ])
    })

    it('keeps the cmd an author named, since a stub cannot guess the suite', () => {
      // Act
      const merged = mergePlan(plan([], 'deno task test'), stubbed([]), 'src/a.ts')

      // Assert
      assertEquals(merged.plan.cmd, 'deno task test')
    })

    it('leaves cmd empty on a first stub, since a command that cannot run reports every mutation as caught', () => {
      // Act
      const merged = mergePlan(null, stubbed([{ at: 'Literal', shape: 'aaaa1111', op: null }]), 'src/a.ts')

      // Assert
      assertEquals(merged.plan.cmd, '')
      assertEquals([merged.kept, merged.added, merged.stale.length], [0, 1, 0])
    })
  })

  describe('mergePlan drift', () => {
    // A selector resolving to a node of a different structure means the op may have changed meaning.
    // Overwriting the shape silently hides that, and keeping the old one makes a later report lie.
    it('writes the new structure and reports the one the node used to carry', () => {
      // Arrange
      const existing = plan([{ at: 'IfStatement', shape: 'b78119ea', op: 'invert', name: 'the guard' }])
      const found = stubbed([{ at: 'IfStatement', shape: 'fc94fba2', op: null }])

      // Act
      const merged = mergePlan(existing, found, 'report.ts')

      // Assert
      assertEquals(merged.drifted, [{ at: 'IfStatement', before: 'b78119ea', after: 'fc94fba2' }])
      assertEquals(merged.plan.mutations[0]?.shape, 'fc94fba2')
      assertEquals(merged.plan.mutations[0]?.op, 'invert')
      assertEquals(merged.plan.mutations[0]?.name, 'the guard')
    })

    it('reports no drift where the node carries the structure the plan recorded', () => {
      // Arrange
      const same = [{ at: 'IfStatement', shape: 'b78119ea', op: 'invert' as const }]

      // Act
      const found = stubbed([{ at: 'IfStatement', shape: 'b78119ea', op: null }])
      const merged = mergePlan(plan(same), found, 'report.ts')

      // Assert
      assertEquals(merged.drifted, [])
    })
  })

  describe('assertRunnable', () => {
    const runnable = (over: Partial<Plan> = {}): Plan => ({
      source: 'redact.ts',
      cmd: 'deno test',
      mutations: [{ at: 'Literal', shape: '400a400a', op: 'value', to: '200' }],
      ...over,
    })

    it('accepts a plan naming a cmd and an op for every mutation', () => {
      // Act & Assert
      assertRunnable(runnable(), 'redact.mut.json')
    })

    // A command that cannot run fails, and a failing suite reads as every mutation being caught.
    it('refuses a plan naming no cmd, since a suite that cannot run reports every mutation as caught', () => {
      // Act & Assert
      assertThrows(() => assertRunnable(runnable({ cmd: '' }), 'redact.mut.json'), CliError)
    })

    // stub leaves op null for a person, so a run reaching one means the plan was never finished.
    it('refuses a mutation still awaiting an op', () => {
      // Arrange
      const unfilled = runnable({ mutations: [{ at: 'Literal', shape: '400a400a', op: null }] })

      // Act & Assert
      assertThrows(() => assertRunnable(unfilled, 'redact.mut.json'), CliError)
    })

    // operator and value name what replaces the node, and neither can be carried out without it.
    it('refuses an operator or a value naming no replacement', () => {
      // Arrange
      const noOperator = runnable({ mutations: [{ at: 'B', shape: 'eeee0001', op: 'operator' }] })
      const noValue = runnable({ mutations: [{ at: 'L', shape: '400a400a', op: 'value' }] })

      // Act & Assert
      assertThrows(() => assertRunnable(noOperator, 'redact.mut.json'), CliError)
      assertThrows(() => assertRunnable(noValue, 'redact.mut.json'), CliError)
    })

    // The five other ops are complete alone, so demanding a replacement refuses a valid plan.
    it('accepts an op that needs no replacement', () => {
      // Arrange
      const dropping = runnable({ mutations: [{ at: 'L', shape: 'eeee0002', op: 'drop-left' }] })

      // Act & Assert
      assertRunnable(dropping, 'redact.mut.json')
    })
  })

  describe('assertResolves', () => {
    const SOURCE = 'export const status = (ok: boolean): number => ok ? 200 : 400\n'

    it('accepts a plan whose every selector names one node', () => {
      // Arrange
      const resolving = plan([{ at: 'Literal[value=400]', shape: '400a400a', op: 'value', to: '500' }])

      // Act & Assert
      assertResolves(resolving, SOURCE, 'status.ts', 'status.mut.json')
    })

    // A stale entry costs a whole suite run before reporting that it never ran.
    // It also reads as a verdict beside the real ones, making a survivor count untrustworthy.
    it('refuses a plan naming a node that is no longer there', () => {
      // Arrange
      const stale = plan([{ at: 'Literal[value=999]', shape: 'dddd9990', op: 'value', to: '1' }])

      // Act & Assert
      assertThrows(() => assertResolves(stale, SOURCE, 'status.ts', 'status.mut.json'), CliError)
    })

    // A selector matching two nodes mutates a site nobody named, which is the ambiguous verdict.
    it('refuses a plan naming more than one node', () => {
      // Arrange
      const ambiguous = plan([{ at: 'Literal', shape: '400a400a', op: 'value', to: '500' }])

      // Act & Assert
      assertThrows(() => assertResolves(ambiguous, SOURCE, 'status.ts', 'status.mut.json'), CliError)
    })

    // The refusal is what a reader acts on, and the two failures are fixed differently: a stale
    // address is rewritten or pruned, where an ambiguous one is narrowed. Naming neither says which.
    it('says which of the two refusals each selector met', () => {
      // Arrange
      const mixed = plan([
        { at: 'Literal[value=999]', shape: 'dddd9990', op: 'value', to: '1' },
        { at: 'Literal', shape: '400a400a', op: 'value', to: '500' },
      ])

      // Act
      const refusal = assertThrows(() => assertResolves(mixed, SOURCE, 'status.ts', 'status.mut.json'), CliError)

      // Assert
      assertEquals(refusal.suggestions.some((line) => line.startsWith('stale')), true)
      assertEquals(refusal.suggestions.some((line) => line.startsWith('ambiguous')), true)
    })

    // One selector reads as singular, which a substring check misses since selector prefixes selectors.
    it('counts one refused selector in the singular and more in the plural', () => {
      // Arrange
      const one = plan([{ at: 'Literal[value=999]', shape: 'dddd9990', op: 'value', to: '1' }])
      const two = plan([
        { at: 'Literal[value=999]', shape: 'dddd9990', op: 'value', to: '1' },
        { at: 'Literal[value=998]', shape: 'dddd9991', op: 'value', to: '1' },
      ])

      // Act
      const single = assertThrows(() => assertResolves(one, SOURCE, 'status.ts', 'status.mut.json'), CliError)
      const several = assertThrows(() => assertResolves(two, SOURCE, 'status.ts', 'status.mut.json'), CliError)

      // Assert
      assertStringIncludes(single.message, '1 selector no longer resolves in')
      assertStringIncludes(several.message, '2 selectors no longer resolve in')
    })
  })

  describe('readPlan and writePlan', () => {
    // A first stub has no plan beside the source, which is absence rather than failure.
    // Reading that as an error would refuse to stub any file that had not been stubbed before.
    it('reads a missing plan as nothing rather than as a failure', async () => {
      // Act
      const missing = await readPlan(`${Deno.makeTempDirSync()}/absent.mut.json`)

      // Assert
      assertEquals(missing, null)
    })

    // The plan is committed beside its source, so it is written for a person to read and diff.
    it('writes a plan indented, since it is committed and read by a person', async () => {
      // Arrange
      const directory = Deno.makeTempDirSync()
      const target = `${directory}/redact.mut.json`
      const written = plan([{ at: 'Literal', shape: '400a400a', op: 'value', to: '200' }])

      // Act
      await writePlan(target, written)
      const text = Deno.readTextFileSync(target)

      // Assert
      assertStringIncludes(text, '\n  "source"')
      assertEquals(text.endsWith('\n'), true)
      assertEquals(await readPlan(target), written)
    })

    // The plans directory does not exist before the first stub, and a write into it would fail.
    it('creates the plans directory, since the first stub writes into one that is not there', async () => {
      // Arrange
      const target = `${Deno.makeTempDirSync()}/nested/.esmut/lib.redact.json`
      const written = plan([{ at: 'Literal', shape: '400a400a', op: 'value', to: '200' }])

      // Act
      await writePlan(target, written)

      // Assert
      assertEquals(await readPlan(target), written)
    })

    // A write is staged beside the plan and renamed, so an interrupt leaves the old plan intact.
    it('leaves no staging file beside the plan it wrote', async () => {
      // Arrange
      const directory = Deno.makeTempDirSync()
      const target = `${directory}/lib.redact.json`

      // Act
      await writePlan(target, plan([{ at: 'Literal', shape: '400a400a', op: 'value', to: '200' }]))
      const left = [...Deno.readDirSync(directory)].map((entry) => entry.name)

      // Assert
      assertEquals(left, ['lib.redact.json'])
    })

    // A failed write leaves nothing to read, and swallowing it reports a plan never written.
    it('reports a write it could not make rather than swallowing it', async () => {
      // Arrange
      const directory = Deno.makeTempDirSync()
      Deno.writeTextFileSync(`${directory}/blocked`, '')

      // Act & Assert
      await assertRejects(() => writePlan(`${directory}/blocked/lib.redact.json`, plan([])), CliError)
    })

    // A failed write stages a sibling of the plan, which would otherwise be left behind.
    it('removes the staging file a failed write left behind', async () => {
      // Arrange
      const directory = Deno.makeTempDirSync()
      const target = `${directory}/lib.redact.json`
      Deno.mkdirSync(`${target}.tmp`)

      // Act
      await assertRejects(() => writePlan(target, plan([])), CliError)

      // Assert: the rename fails onto a directory, and the staging path is cleared.
      assertEquals([...Deno.readDirSync(directory)].map((entry) => entry.name), [])
    })

    // Zod names the field that failed, and the path tells a reader which of their plans to open.
    it('names the plan it could not parse, so a reader knows which file to open', async () => {
      // Arrange
      const target = `${Deno.makeTempDirSync()}/lib.redact.json`
      Deno.writeTextFileSync(target, '{ "source": "a.ts" }')

      // Act
      const refused = await assertRejects(() => readPlan(target), CliError)

      // Assert: the path named is the one it read, not one derived from it.
      assertEquals(refused.message, `The plan at ${target} is not the shape a run reads`)
    })
  })

  describe('mergePlan filledBy', () => {
    // A plan whose ops a script chose records that, since no author's judgment stands behind them.
    it('carries the record of who filled a plan rather than writing one of its own', () => {
      // Arrange
      const authored: Plan = { source: 'src/a.ts', cmd: 'deno task test', mutations: [] }
      const swept: Plan = { ...authored, filledBy: 'sweep' }

      // Act
      const byHand = mergePlan(authored, stubbed([]), 'src/a.ts')
      const byScript = mergePlan(swept, stubbed([]), 'src/a.ts')

      // Assert
      assertEquals(byHand.plan.filledBy, undefined)
      assertEquals(byScript.plan.filledBy, 'sweep')
    })
  })
})
