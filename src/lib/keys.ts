import { visitorKeys } from '@typescript-eslint/visitor-keys'

// estraverse names no children for the TS-only kinds, so a tenth of the tree would be unreachable.
// Unreachable reads as the stale verdict, and visitor-keys admits an undefined esquery does not.
export const known: Record<string, readonly string[]> = {}

for (const [type, keys] of Object.entries(visitorKeys)) {
  if (keys) known[type] = keys
}
