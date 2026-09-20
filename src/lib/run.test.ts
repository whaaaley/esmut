import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { describe, it } from 'node:test'
import { fromFileUrl } from '@std/path'
import { CliError } from '../utils/error.utils.ts'
import { judge, prepare, runPlan, suiteFails, SuiteTimeout } from './run.ts'
import type { Mutation, Plan } from './schema.ts'

const SOURCE = 'export const status = (ok: boolean): number => ok ? 200 : 400\n'

// The source is judged once per plan, so a case prepares it the way a run does.
const READY = prepare(SOURCE, 'status.ts')

const mutation = (over: Partial<Mutation> = {}): Mutation => ({
  at: 'Literal[value=400]',
  shape: '400a400a',
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
    // The compiler's own objection is what says which mutation to fix, so the verdict carries it.
    it('reports a mutant the compiler refuses as invalid rather than killed', () => {
      // Act
      const judged = judge(READY, mutation({ to: 'missing' }))

      // Assert
      assertEquals('verdict' in judged && judged.verdict.outcome, 'invalid')
      assert('verdict' in judged && judged.verdict.because?.includes('missing'), 'the verdict names no reason')
    })

    // An op the node cannot take is a plan to fix, and reporting it lets the run finish.
    // A drop keeps one side, so the refusal names the side it would have kept rather than dropped.
    it('reports an op the node cannot take as invalid rather than throwing', () => {
      // Act
      const judged = judge(READY, mutation({ op: 'drop-left', to: undefined }))

      // Assert
      assertEquals('verdict' in judged && judged.verdict.outcome, 'invalid')
      assert('verdict' in judged && judged.verdict.because?.includes('carries no right'), 'the verdict names no reason')
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

    // The loop restores after each suite, so finally is the only restore where that write failed.
    // A source the run cannot write to is how that happens, and an unguarded write there throws
    // before the listeners come off, which leaves the handlers registered and the mutant on disk.
    it('names the file it could not restore rather than leaving a mutant unreported', async () => {
      // Arrange
      const path = write(SOURCE)
      let asked = 0

      // The file goes read-only during the first suite, so the restore after it cannot write.
      const hostile = async (): Promise<boolean> => {
        asked += 1
        if (asked === 1) await Deno.chmod(path, 0o400)

        return true
      }

      // Act & Assert
      const refusal = await assertRejects(
        () => runPlan(path, planning([mutation(), mutation({ to: '600' })]), hostile),
        CliError,
      )

      assertStringIncludes(refusal.message, 'Cannot restore')
      assert(refusal.suggestions.some((line) => line.includes('mutant')), `${refusal.suggestions} names no mutant`)

      // The file is left writable for the runner that follows, whatever the run did to it.
      await Deno.chmod(path, 0o600)
    })

    // The handlers are added per run, so a run that leaves them behind stacks another pair on the
    // next one and the stale one exits 130 on any later signal. That is invisible in-process, since
    // Deno exposes no listener count, so the exit code of a child signalled after the run says it.
    it('drops the handlers it added, so a later signal takes the default disposition', async () => {
      // Arrange
      const directory = Deno.makeTempDirSync()
      const path = `${directory}/target.ts`
      Deno.writeTextFileSync(path, SOURCE)
      const written = { source: 'target.ts', cmd: 'true', mutations: [mutation()] }
      Deno.writeTextFileSync(`${directory}/plan.mut.json`, JSON.stringify(written))

      const config = fromFileUrl(new URL('../../deno.json', import.meta.url))
      const script = `${directory}/idle.ts`
      const entry = new URL('./run.ts', import.meta.url).href
      const parse = new URL('./plan.ts', import.meta.url).href

      // The child runs the plan to completion, says so, then waits to be signalled.
      Deno.writeTextFileSync(
        script,
        `import { runPlan } from '${entry}'\nimport { parsePlan } from '${parse}'\n` +
          `await runPlan('${path}', parsePlan(Deno.readTextFileSync('${directory}/plan.mut.json'), 'p'))\n` +
          `console.log('ran')\nawait new Promise((resolve) => setTimeout(resolve, 20000))\n`,
      )

      const child = new Deno.Command(Deno.execPath(), {
        args: ['run', '--config', config, ...PERMISSIONS, script],
        stdout: 'piped',
        stderr: 'null',
      }).spawn()

      // Act: the signal comes after the run finished, so only a handler it forgot could answer it.
      const reader = child.stdout.getReader()
      const decoder = new TextDecoder()
      let said = ''

      while (!said.includes('ran')) {
        const { value, done } = await reader.read()
        if (done) break

        said += decoder.decode(value)
      }

      reader.releaseLock()
      child.kill('SIGTERM')
      const status = await child.status

      // Assert: 143 is the default for SIGTERM, where a handler the run left behind exits 130.
      assertEquals(said.includes('ran'), true)
      assertEquals(status.code, 143)
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
      const status = await child.status

      // Assert
      assertEquals(during.includes('500'), true)
      assertEquals(Deno.readTextFileSync(path), SOURCE)

      // The handler exits rather than returning, and 130 is what a shell reads as killed by a signal.
      // A run exiting 0 here would read as a clean finish to whatever called it.
      assertEquals(status.code, 130)
    })

    // Both signals are registered, and a run listening to only one leaves the mutant on disk for
    // the other. Ctrl-C is the interrupt a person actually sends, so SIGINT gets its own case.
    it('restores the source when the run is interrupted rather than terminated', async () => {
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
        args: ['run', '--config', config, ...PERMISSIONS, script],
        stdout: 'null',
        stderr: 'null',
      }).spawn()

      // Act: wait for the mutant to reach disk, then interrupt rather than terminate.
      let during = ''

      for (let waited = 0; waited < 40 && !during.includes('500'); waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        during = Deno.readTextFileSync(path)
      }

      child.kill('SIGINT')
      const status = await child.status

      // Assert
      assertEquals(during.includes('500'), true)
      assertEquals(Deno.readTextFileSync(path), SOURCE)
      assertEquals(status.code, 130)
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

    // Inverting a loop guard is one of the seven ops, so a mutant that never returns is a shape
    // this tool produces. A run waiting on one waits forever, and the rest of the plan never runs.
    it('reads a suite that never finishes as invalid and keeps going', async () => {
      // Arrange
      const plan: Plan = {
        source: 'status.ts',
        cmd: 'ignored, since the suite is the stand-in below',
        mutations: [mutation(), mutation({ to: '600' })],
      }

      const path = `${Deno.makeTempDirSync()}/status.ts`
      Deno.writeTextFileSync(path, SOURCE)

      // A suite that hangs on the first mutation and answers on the second.
      let asked = 0

      const hangs = async (): Promise<boolean> => {
        asked += 1
        if (asked === 1) throw new SuiteTimeout(10)

        return await Promise.resolve(true)
      }

      // Act
      const verdicts = await runPlan(path, plan, hangs)

      // Assert: the hang is the first mutation's verdict, and the second still ran.
      assertEquals(verdicts.map((verdict) => verdict.outcome), ['invalid', 'killed'])
      assertEquals(verdicts[0]?.because?.includes('did not finish'), true)
      assertEquals(Deno.readTextFileSync(path), SOURCE)
    })
  })

  describe('suiteFails', () => {
    // The bound is what stops one mutant holding a run open, so it has to actually fire.
    it('refuses a command that does not return within the bound', async () => {
      // Act & Assert
      await assertRejects(() => suiteFails('sleep 30', { timeoutMs: 250 }), SuiteTimeout)
    })

    // A command that answers inside the bound is read by its exit code, as it always was.
    it('reads an exit code where the command finishes in time', async () => {
      // Act & Assert
      assertEquals(await suiteFails('true', { timeoutMs: 30_000 }), false)
      assertEquals(await suiteFails('false', { timeoutMs: 30_000 }), true)
    })

    // The timeout is told apart from any other failure by its name, which runPlan reads to decide
    // whether the hang is this mutation's verdict or the whole plan's error.
    it('names the timeout, since a run tells it from any other failure by that', async () => {
      // Act
      const refusal = await assertRejects(() => suiteFails('sleep 30', { timeoutMs: 200 }), SuiteTimeout)

      // Assert
      assertEquals(refusal.name, 'SuiteTimeout')
      assertEquals(refusal.ms, 200)
    })

    // The bound is the signal handed to the command, so a command started without it runs unbounded
    // and the wait above would never end. The child being gone afterwards is what says it was killed.
    it('kills the command it bounded rather than leaving it running', async () => {
      // Act: a sleep long enough that only a kill ends it inside the assertion below.
      const started = Date.now()
      await assertRejects(() => suiteFails('sleep 30', { timeoutMs: 250 }), SuiteTimeout)
      const waited = Date.now() - started

      // Assert: the wait ended near the bound rather than after the sleep, so the child was killed.
      assert(waited < 5_000, `waited ${waited}ms, so the command outlived its bound`)
    })
  })
})
