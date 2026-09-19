import { fromFileUrl } from '@std/path'
import { diagnose, introduced } from './check.ts'
import { parsePlan } from './plan.ts'
import { openGate } from './check.ts'
import { judge, prepare } from './run.ts'

// A run pays three costs per mutation: it type-checks the source, type-checks the mutant, and
// runs the suite. These measure the first two, which are the ones esmut controls.
// The suite is the plan's own cmd, measured per plan by running it rather than benched here.
const ROOT = fromFileUrl(new URL('../../', import.meta.url))

const PLAN = parsePlan(Deno.readTextFileSync(`${ROOT}.esmut/lib.score.json`), 'lib.score.json')

const PATH = `${ROOT}${PLAN.source}`

const SOURCE = Deno.readTextFileSync(PATH)

const GATE = openGate(PATH)
const READY = prepare(SOURCE, PATH)

// The first mutation that resolves and applies, which is what a run reaches before the suite.
// judge already returns the mutant, so asking it beats rebuilding the splice here.
const MUTANT = ((): string => {
  for (const mutation of PLAN.mutations) {
    const judged = judge(READY, mutation)
    if ('mutant' in judged) return judged.mutant
  }

  throw new Error('No mutation in the plan applies, so there is nothing to measure')
})()

// The whole reason a run is slow. ts.createProgram parses every import of the file under test,
// and nothing is reused between calls, so this is paid once per side of every mutation.
Deno.bench('diagnose, one side of one mutation', () => {
  diagnose(GATE, SOURCE)
})

// The source side is the same call with the same arguments for every mutation in a plan.
// Measuring it beside the mutant side is what says whether hoisting it out of the loop pays.
Deno.bench('diagnose the mutant, which differs per mutation', () => {
  diagnose(GATE, MUTANT)
})

// What a run actually pays per mutation today, since judge type-checks both sides.
Deno.bench('both sides, which is what judge costs per mutation', () => {
  introduced(diagnose(GATE, SOURCE), diagnose(GATE, MUTANT))
})

// What one mutation costs now that the source side is prepared once for the whole plan.
// The gap against the bench above is what hoisting the walk and the clean diagnose won back.
Deno.bench('judge one mutation against a prepared source', () => {
  const [first] = PLAN.mutations
  if (first) judge(READY, first)
})

// Paid once per plan rather than once per mutation, so a plan of 146 pays this a single time.
Deno.bench('prepare, which a plan pays once', () => {
  prepare(SOURCE, PATH)
})

// Writing a mutant to disk, which a worktree lane does once per mutation.
// Measured against the gate to show which of the two a run is actually waiting on.
Deno.bench('write a mutant to disk', () => {
  const where = Deno.makeTempFileSync({ suffix: '.ts' })
  Deno.writeTextFileSync(where, MUTANT)
  Deno.removeSync(where)
})
