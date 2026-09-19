# esmut

Selector-addressed mutation testing for TypeScript and JavaScript.

## What mutation testing is

[Mutation testing](https://en.wikipedia.org/wiki/Mutation_testing) introduces a deliberate bug, called a mutant, and reruns the suite.
A failing test kills the mutant; a passing suite means it survived, and nothing was checking that behavior.
Coverage shows which lines ran.
This shows which behaviors are checked.

## Plans

A plan is a json file under `.esmut/`, named for the source it mutates, holding one mutation per entry.
Each mutation names a node with an [ESQuery](https://github.com/estools/esquery) selector and an operation to perform on it.

```jsonc
// .esmut/auth.session.json
{
  "source": "src/auth/session.ts",
  "cmd": "deno test --allow-read src/auth/session.test.ts",
  "mutations": [
    {
      "at": "IfStatement > BinaryExpression[operator='<']",
      "was": "expiresAt < now",
      "op": "invert",
      "name": "an expired session is accepted"
    }
  ]
}
```

`esmut stub` writes this file with the selectors filled in and the ops left empty.

A site it cannot address with a selector matching exactly one node goes into a `skipped` array instead, carrying its line and column so the anchor can be written by hand.
Re-running `stub` keeps every op and name already filled, adds newly found sites, and reports any selector that has gone stale or now reads differently.

## Selectors

[ESQuery](https://github.com/estools/esquery) is the CSS-style selector language ESLint uses over ESTree.
Write one with `esmut query` and narrow it until it matches exactly one node.

```
esmut query src/auth/session.ts "BinaryExpression"
  3 matches
    session.ts:12:7    expiresAt < now
    session.ts:19:22   role === 'admin'
    session.ts:24:11   attempts > 5

esmut query src/auth/session.ts "IfStatement > BinaryExpression[operator='<']"
  1 match
    session.ts:12:7    expiresAt < now
```

Matching nothing is `stale`, matching more than one is `ambiguous`, and both are refused.

## Ops

| `op` | Applies to | Effect |
|---|---|---|
| `invert` | guard / boolean expression | adds or removes negation |
| `drop-left` | `&&` `\|\|` | keeps the right operand only |
| `drop-right` | `&&` `\|\|` | keeps the left operand only |
| `operator` | binary expression | swaps the operator; needs `to` |
| `value` | literal | replaces the literal; needs `to` |
| `empty` | array / object / string literal | replaces with the empty form |
| `remove` | statement / call in a block | deletes the node |

## Type gate

Every mutant is type-checked before the suite runs.
One that does not compile is reported `invalid` rather than `killed`.
A test command that fails to build would otherwise look like a test catching the mutation.

## Install

From a clone:

```
deno install --global --force --name esmut --config deno.json \
  --allow-read --allow-write --allow-run --allow-env --allow-sys src/esmut.ts
```

`--config` is not optional.
Without it the install drops the import map, and the binary fails at run time on its first import rather than at install time.

## Commands

```
esmut query <file> "<selector>"   matches, with file:line:col and the source line
esmut stub <file>                 emit a plan with selectors filled and ops empty
esmut <file|dir>                  run the planned mutations
esmut check <file|dir>            resolve selectors, report stale and ambiguous, run nothing
```

```
esmut src/auth/session.ts

  session.ts
    survived  an expired session is accepted
    1 survived, 3 killed
```

| verdict | meaning |
|---|---|
| `killed` | a test failed, so something checks this behavior |
| `survived` | the suite passed, so nothing does |
| `invalid` | the mutant does not compile, so it never ran |
| `stale` | the selector matches nothing |
| `ambiguous` | the selector matches more than one node |

Exit code stays 0 whether or not a mutation survived.
Progress goes to stderr and the summary to stdout.

A run refuses a plan whose `cmd` is missing, whose ops are unfilled, or whose selectors no longer resolve, rather than reporting a verdict for a mutation that never ran.

## The loop

```
stub -> fill ops -> run -> fix survivors -> run
```

1. `esmut stub <file>` writes the plan, then fill in an op and a name for each mutation.
2. `esmut <file>` runs them.
3. Fix each survivor by asserting the behavior it broke, never by deleting the mutation.
4. `esmut check <file>` after a refactor, to see which selectors stopped resolving.

A survivor is the finding.
Deleting the mutation to make a run clean hides the gap it found.

## Drift

A selector can still resolve while the node it names reads differently, which means the op chosen for it may no longer mean what its author meant.
`stub` reports that as drift, with a diff of what the node used to be.

Set `ESMUT_DIFF` to use a different differ:

```
ESMUT_DIFF="git diff --no-index" esmut stub src/auth/session.ts
```

## Developing

```
deno task test          unit tests, about a second
deno task test:corpus   the fixture sweep, which stubs 15 files
deno task test:all      both
```

esmut is tested with itself.
`.esmut/` holds a plan per source file, and the sweeps have found several bugs in esmut that its own mutations surfaced.
