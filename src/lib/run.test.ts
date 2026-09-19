import { assertEquals } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import { judge, prepare, runPlan } from './run.ts'
import type { Mutation, Plan } from './schema.ts'

const SOURCE = 'export const status = (ok: boolean): number => ok ? 200 : 400\n'

// The source is judged once per plan, so a case prepares it the way a run does.
const READY = prepare(SOURCE, 'status.ts')

const mutation = (over: Partial<Mutation> = {}): Mutation => ({
  at: 'Literal[value=400]',
  was: '400',
  op: 'value',
  to: '500',
  ...over,
})

const PERMISSIONS = ['--allow-read', '--allow-write', '--allow-run', '--allow-env', '--allow-sys']

describe('All Run Tests', () => {
  describe('judge', () => {
    // A selector matching nothing names a node that moved, the stale verdict rather than a failure.
    it('reports a selector matching nothing as stale', () => {
      // Act
      const judged = judge(READY, mutation({ at: 'Literal[value=999]' }))

      // Assert
      assertEquals('verdict' in judged && judged.verdict.outcome, 'stale')
    })

    // A selector matching more than one node would mutate a site nobody named, so it is refused.
    it('reports a selector matching more than one node as ambiguous', () => {
      // Act
      const judged = judge(READY, mutation({ at: 'Literal' }))

      // Assert
      assertEquals('verdict' in judged && judged.verdict.outcome, 'ambiguous')
    })

    // A mutant that does not compile never ran, so reporting it killed credits a blind test.
    it('reports a mutant the compiler refuses as invalid rather than killed', () => {
      // Act
      const judged = judge(READY, mutation({ to: 'missing' }))

      // Assert
      assertEquals('verdict' in judged && judged.verdict.outcome, 'invalid')
    })

    // An op the node cannot take is a plan to fix, and reporting it lets the run finish.
    it('reports an op the node cannot take as invalid rather than throwing', () => {
      // Act
      const judged = judge(READY, mutation({ op: 'drop-left', to: undefined }))

      // Assert
      assertEquals('verdict' in judged && judged.verdict.outcome, 'invalid')
    })

    it('returns the mutant where the mutation compiles', () => {
      // Act
      const judged = judge(READY, mutation())

      // Assert
      assertEquals('mutant' in judged && judged.mutant.includes('500'), true)
    })
  })

  describe('runPlan', () => {
    const write = (source: string): string => {
      const path = `${Deno.makeTempDirSync()}/status.ts`
      Deno.writeTextFileSync(path, source)

      return path
    }

    const planning = (mutations: Mutation[]): Plan => ({ source: 'status.ts', cmd: 'unused', mutations })

    // A suite that fails on the mutant is one that checks the behavior, which is what killed means.
    it('reads a failing suite as killed and a passing one as survived', async () => {
      // Arrange
      const path = write(SOURCE)

      // Act
      const killed = await runPlan(path, planning([mutation()]), () => Promise.resolve(true))
      const survived = await runPlan(path, planning([mutation()]), () => Promise.resolve(false))

      // Assert
      assertEquals(killed.map((verdict) => verdict.outcome), ['killed'])
      assertEquals(survived.map((verdict) => verdict.outcome), ['survived'])
    })

    // The suite reads the mutant from disk, so the run must write it before the suite is asked.
    it('writes the mutant before running the suite against it', async () => {
      // Arrange
      const path = write(SOURCE)
      const seen: string[] = []

      // Act
      await runPlan(path, planning([mutation()]), () => {
        seen.push(Deno.readTextFileSync(path))
        return Promise.resolve(true)
      })

      // Assert
      assertEquals(seen[0]?.includes('500'), true)
    })

    // An interrupted run must leave the source as it found it, or a mutant is committed.
    it('restores the source after the run and after a suite that throws', async () => {
      // Arrange
      const path = write(SOURCE)

      // Act
      await runPlan(path, planning([mutation()]), () => Promise.resolve(true))
      const afterRun = Deno.readTextFileSync(path)

      const failing = runPlan(path, planning([mutation()]), () => Promise.reject(new Error('interrupted')))
      await failing.catch(() => undefined)

      // Assert
      assertEquals(afterRun, SOURCE)
      assertEquals(Deno.readTextFileSync(path), SOURCE)
    })

    // A signal does not unwind the stack, so finally never runs and the mutant outlives the run.
    // This is the promise the tool makes about its own safety, and a kill is how it is tested.
    it('restores the source when the run is killed rather than thrown out of', async () => {
      // Arrange
      const directory = Deno.makeTempDirSync()
      const path = `${directory}/target.ts`
      Deno.writeTextFileSync(path, SOURCE)
      const written = { source: 'target.ts', cmd: 'sleep 30', mutations: [mutation()] }
      Deno.writeTextFileSync(`${directory}/plan.mut.json`, JSON.stringify(written))

      const config = fromFileUrl(new URL('../../deno.json', import.meta.url))
      const script = `${directory}/run.ts`
      const entry = new URL('./run.ts', import.meta.url).href
      const parse = new URL('./plan.ts', import.meta.url).href
      Deno.writeTextFileSync(
        script,
        `import { runPlan } from '${entry}'\nimport { parsePlan } from '${parse}'\n` +
          `await runPlan('${path}', parsePlan(Deno.readTextFileSync('${directory}/plan.mut.json'), 'p'))\n`,
      )

      const child = new Deno.Command(Deno.execPath(), {
        // The script sits in a temp directory, so the project's import map has to be named for it.
        args: ['run', '--config', config, ...PERMISSIONS, script],
        stdout: 'null',
        stderr: 'null',
      }).spawn()

      // Act: wait for the mutant to reach disk rather than guessing the gate's duration, then kill.
      let during = ''

      for (let waited = 0; waited < 40 && !during.includes('500'); waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        during = Deno.readTextFileSync(path)
      }

      child.kill('SIGTERM')
      await child.status

      // Assert
      assertEquals(during.includes('500'), true)
      assertEquals(Deno.readTextFileSync(path), SOURCE)
    })

    // A verdict needing no suite costs no disk, so a stale selector never writes anything.
    it('judges a stale selector without writing or running anything', async () => {
      // Arrange
      const path = write(SOURCE)
      let asked = 0

      // Act
      const verdicts = await runPlan(path, planning([mutation({ at: 'Literal[value=999]' })]), () => {
        asked += 1
        return Promise.resolve(true)
      })

      // Assert
      assertEquals(verdicts.map((verdict) => verdict.outcome), ['stale'])
      assertEquals(asked, 0)
    })
  })
})
