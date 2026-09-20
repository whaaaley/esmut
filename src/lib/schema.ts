import { z } from 'zod'

export const OPS = ['invert', 'drop-left', 'drop-right', 'operator', 'value', 'empty', 'remove'] as const

const opSchema = z.enum(OPS)

// A plan is hand-edited, so every object is strict and every field is bounded.
// A misspelled key is the common mistake, and a permissive object reads it as a field nobody set.
const mutationSchema = z.strictObject({
  // An ESQuery selector naming one node, which is stale at 0 matches and ambiguous above 1.
  // An empty selector parses and matches everything, so it is refused here rather than at the run.
  at: z.string().min(1),
  // The matched node's structure when the plan was written, never used to find the node.
  // A formatter rewriting a line leaves this alone, so a reflow is not reported as a change.
  shape: z.string(),
  // Null until an author picks one, since the tool locates sites but cannot judge them.
  op: opSchema.nullable(),
  to: z.string().optional(),
  name: z.string().optional(),
})

export const planSchema = z.strictObject({
  source: z.string().min(1),
  // Empty from stub, since a guessed command that cannot run reports every mutation as caught.
  cmd: z.string(),
  // A plan whose ops a script chose records that, since no author's judgment stands behind them.
  // stub writes it because it fills the op it can derive, leaving the rest null for an author.
  filledBy: z.enum(['stub', 'sweep']).optional(),
  mutations: z.array(mutationSchema),
})

export type Op = z.infer<typeof opSchema>
export type Mutation = z.infer<typeof mutationSchema>
export type Plan = z.infer<typeof planSchema>
