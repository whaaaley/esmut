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
    it('leaves every op it wrote for a person to fill', async () => {
      // Arrange
      const path = written()

      // Act
      await stub(path)
      const plan = await readPlan(planPath(path))

      // Assert
      assertEquals(plan?.mutations.every((mutation) => mutation.op === null), true)
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
      const stale = { at: 'Literal[value=999]', was: '999', op: null }
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
