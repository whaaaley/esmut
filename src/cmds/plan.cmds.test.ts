import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from 'node:test'
import { check } from './check.ts'
import { run } from './run.ts'
import { stub } from './stub.ts'
import { ESMUT_DIR, planPath, readPlan } from '../lib/plan.ts'
import { CliError } from '../utils/error.utils.ts'

const SOURCE = 'export const status = (ok: boolean): number => ok ? 200 : 400\n'

// A plan is named for its source path, so stubbing a temp source writes into this project's plans.
// Each test removes the plan it wrote rather than leaving one named for a vanished directory.
const written = (source = SOURCE): string => {
  const path = `${Deno.makeTempDirSync()}/status.ts`
  Deno.writeTextFileSync(path, source)

  return path
}

// A plan written for a temp source is named for a directory that will not exist, so it is swept.
const sweep = (): void => {
  for (const entry of Deno.readDirSync(ESMUT_DIR)) {
    if (entry.name.startsWith('tmp.')) Deno.removeSync(`${ESMUT_DIR}/${entry.name}`)
  }
}

// Each command prints, so what it printed is the only evidence the pieces were wired together.
const printed = async (task: () => Promise<void>): Promise<string> => {
  const lines: string[] = []
  const log = console.log

  console.log = (line: string): void => {
    lines.push(line)
  }

  try {
    await task()
  } finally {
    console.log = log
  }

  return lines.join('\n')
}

describe('All Plan Command Tests', () => {
  describe('stub', () => {
    // The plan is what stub exists to produce, so writing it is the behavior, not the report.
    it('writes a plan beside the source and reports what it wrote', async () => {
      // Arrange
      const path = written()

      // Act
      const output = await printed(() => stub(path))
      const plan = await readPlan(planPath(path))

      // Assert
      assertEquals(plan?.source, path)
      assertEquals((plan?.mutations.length ?? 0) > 0, true)
      assertStringIncludes(output, 'sites')
    })

    // stub leaves every op for a person, and filling one puts a machine where judgment belongs.
    // The op is derived where the node says what it can be, and the plan records that a script
    // chose it. The cmd is still left empty, since no stub can guess which suite covers the file.
    it('writes the op it derived and says the plan was filled by the stub', async () => {
      // Arrange
      const path = written()

      // Act
      await stub(path)
      const plan = await readPlan(planPath(path))

      // Assert
      assertEquals(plan?.mutations.every((mutation) => mutation.op !== null), true)
      assertEquals(plan?.filledBy, 'stub')
      assertEquals(plan?.cmd, '')
    })

    it('refuses a file it cannot read', async () => {
      // Act & Assert
      await assertRejects(() => stub('/absent/status.ts'), CliError)
    })
  })

  describe('check', () => {
    // check resolves without running, so a selector that still matches reports resolved.
    it('reports what resolved without running a suite', async () => {
      // Arrange
      const path = written()
      await stub(path)

      // Act
      const output = await printed(() => check(path))

      // Assert
      assertStringIncludes(output, 'resolved')
      assertStringIncludes(output, '0 refused')
    })

    // A selector matching nothing is stale, which is the finding check exists to surface.
    it('names a selector that no longer matches', async () => {
      // Arrange
      const path = written()
      await stub(path)

      const target = planPath(path)
      const plan = await readPlan(target)
      const stale = { at: 'Literal[value=999]', shape: 'dddd9990', op: null }
      Deno.writeTextFileSync(target, JSON.stringify({ ...plan, mutations: [stale] }, null, 2))

      // Act
      const output = await printed(() => check(path))

      // Assert
      assertStringIncludes(output, 'stale')
      assertStringIncludes(output, '1 refused')
    })

    // Checking a file nobody stubbed is a missing plan rather than one resolving to nothing.
    it('refuses a source carrying no plan', async () => {
      // Act & Assert
      await assertRejects(() => check(written()), CliError)
    })

    // A stale entry names code that is gone, and a stale selector still scores, so a plan keeping
    // one reports depth for code nobody can mutate. Pruning is asked for rather than assumed.
    it('drops a stale entry when asked to prune and keeps the rest', async () => {
      // Arrange
      const path = written()
      await stub(path)

      const target = planPath(path)
      const before = await readPlan(target)
      const resolving = before?.mutations ?? []
      const stale = { at: 'Literal[value=999]', shape: 'dddd9990', op: 'value' as const, to: '1' }
      Deno.writeTextFileSync(target, JSON.stringify({ ...before, mutations: [...resolving, stale] }, null, 2))

      // Act
      await printed(() => check(path, { prune: true }))
      const after = await readPlan(target)

      // Assert
      assertEquals(after?.mutations.length, resolving.length)
      assertEquals(after?.mutations.some((mutation) => mutation.at === stale.at), false)
    })

    // The op and the name are an author's work, so what a prune deletes is printed rather than
    // dropped silently, which is the only record the entry ever existed.
    it('names what it dropped, since an entry carries an op somebody chose', async () => {
      // Arrange
      const path = written()
      await stub(path)

      const target = planPath(path)
      const before = await readPlan(target)
      const stale = { at: 'Literal[value=999]', shape: 'dddd9990', op: 'value' as const, to: '1', name: 'the gap nobody covers' }
      Deno.writeTextFileSync(target, JSON.stringify({ ...before, mutations: [stale] }, null, 2))

      // Act
      const output = await printed(() => check(path, { prune: true }))

      // Assert
      assertStringIncludes(output, 'the gap nobody covers')
    })

    // An ambiguous selector names a node that is still there, so the entry is a selector to narrow
    // rather than work to delete. Dropping it would lose an op over a fixable address.
    it('keeps an ambiguous entry, which names code that still exists', async () => {
      // Arrange
      const path = written()
      await stub(path)

      const target = planPath(path)
      const before = await readPlan(target)
      const ambiguous = { at: 'Literal', shape: 'dddd9990', op: 'value' as const, to: '1' }
      Deno.writeTextFileSync(target, JSON.stringify({ ...before, mutations: [ambiguous] }, null, 2))

      // Act
      await printed(() => check(path, { prune: true }))
      const after = await readPlan(target)

      // Assert
      assertEquals(after?.mutations.length, 1)
    })

    // Checking without the flag is the report it has always been, so a plan is never rewritten.
    it('leaves the plan alone where no prune was asked for', async () => {
      // Arrange
      const path = written()
      await stub(path)

      const target = planPath(path)
      const before = await readPlan(target)
      const stale = { at: 'Literal[value=999]', shape: 'dddd9990', op: null }
      Deno.writeTextFileSync(target, JSON.stringify({ ...before, mutations: [stale] }, null, 2))

      // Act
      await printed(() => check(path))
      const after = await readPlan(target)

      // Assert
      assertEquals(after?.mutations.length, 1)
    })
  })

  describe('run', () => {
    // A plan stub wrote carries no cmd, and running it would report every mutation as caught.
    it('refuses a plan naming no cmd, which is what stub always writes', async () => {
      // Arrange
      const path = written()
      await stub(path)

      // Act
      const refused = await assertRejects(() => run(path), CliError)

      // Assert
      assertStringIncludes(refused.message, 'cmd')
    })

    it('refuses a source carrying no plan', async () => {
      // Act & Assert
      await assertRejects(() => run(written()), CliError)
    })
  })

  it('leaves no plan behind for a source that will not exist again', () => {
    // Act
    sweep()

    // Assert
    const left = [...Deno.readDirSync(ESMUT_DIR)].filter((entry) => entry.name.startsWith('tmp.'))
    assertEquals(left, [])
  })
})
