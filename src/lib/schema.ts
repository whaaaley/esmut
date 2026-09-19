import { z } from 'zod'

export const OPS = ['invert', 'drop-left', 'drop-right', 'operator', 'value', 'empty', 'remove'] as const

const opSchema = z.enum(OPS)

// A plan is hand-edited, so every object is strict and every field is bounded.
// A misspelled key is the common mistake, and a permissive object reads it as a field nobody set.
const mutationSchema = z.strictObject({
  // An ESQuery selector naming one node, which is stale at 0 matches and ambiguous above 1.
  // An empty selector parses and matches everything, so it is refused here rather than at the run.
  at: z.string().min(1),
  // The matched node's source when the plan was written, never used to find the node.
  was: z.string(),
  // Null until an author picks one, since the tool locates sites but cannot judge them.
  op: opSchema.nullable(),
  to: z.string().optional(),
  name: z.string().optional(),
})

// A site the generator found but could not address, kept out of mutations so a run never reads it.
// The position is printed for a reader to jump to, so a fractional or negative one names no line.
const skippedSchema = z.strictObject({
  was: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
  ops: z.array(opSchema),
})

export const planSchema = z.strictObject({
  source: z.string().min(1),
  // Empty from stub, since a guessed command that cannot run reports every mutation as caught.
  cmd: z.string(),
  // A plan whose ops a script chose records that, since no author's judgment stands behind them.
  filledBy: z.literal('sweep').optional(),
  mutations: z.array(mutationSchema),
  skipped: z.array(skippedSchema).optional(),
})

export type Op = z.infer<typeof opSchema>
export type Mutation = z.infer<typeof mutationSchema>
export type Skipped = z.infer<typeof skippedSchema>
export type Plan = z.infer<typeof planSchema>
