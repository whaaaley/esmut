# esmut

Selector-addressed mutation testing for TypeScript and JavaScript.

**A proof of concept.** It works and it is self-hosted, but [Stryker](https://stryker-mutator.io)
is the better tool for this job today, and the honest comparison is below.

## Use Stryker instead, unless you want a plan

Measured on one file, same suite command, same machine:

| | Stryker | esmut |
|---|---|---|
| wall time | **32s** | 93.6s (four workers) |
| mutants run | 166 | 206 |
| survivors found | **13** | 0 |
| mutants refused for not compiling | 0 | **30** |
| setup | none | a plan per source |

Stryker is faster because it instruments a file once with every mutant behind a switch and selects
one per run, where this writes a mutant and reruns from cold.
It finds more because it has 19 mutator classes to these seven ops.

Two things here are still worth something:

**The type gate.** Stryker has no compiler check, so a mutant that does not compile fails the suite
and is counted as killed. That is a false kill. The 30 above are mutants it would have miscounted.

**A plan is a reviewable artifact.** A mutation names a site, an op, and the behavior it probes, and
it is committed. Stryker's mutants are regenerated each run and cannot be curated.

That second one is also where the cost is. Selectors do not rot less than line numbers, they rot
differently: a selector breaks when code moves **or** when an unrelated sibling appears, and the
repair needs judgment where a line shift is mechanical. `check`, `--prune`, `shape` hashing, drift,
and two of the five verdicts exist to service that.

A sibling project, `es_oasis`, asks a different question with none of this machinery: which of your
tests fails to distinguish anything.

`src/lib/sandbox.ts` and `src/lib/pool.ts` run suites in throwaway copies of the tree, so a mutant
never reaches the source. `run` does not use them yet: parallelism measured at **0.96x** on a
12 core machine, where four workers overlap 3.71x and each suite slows by almost exactly four.
The sandbox is worth keeping for the isolation alone, since the serial runner writes a deliberate
defect into the tree and relies on a `finally` and two signal handlers to take it back out.

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
  "filledBy": "stub",
  "mutations": [
    {
      "at": "IfStatement > BinaryExpression[operator='<']",
      "shape": "b78119ea",
      "op": "invert",
      "name": "an expired session is accepted"
    }
  ]
}
```

`esmut stub` writes this file with a selector for every site and the op it can derive from the node.
Where no op can be derived, such as a regex literal that has no other value to read as, `op` stays null for an author to fill.
A plan whose ops came from the stub rather than from a person says `filledBy`, since a derived op is a guess about what is worth testing.

`shape` is a hash of the node's structure, which is what drift is judged by.
It is never used to find the node.

Every site gets a selector, so nothing is left out of a plan.
Re-running `stub` keeps every op and name already filled, adds newly found sites, and reports any selector that has gone stale or now names a different structure.

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

`stub` writes its own selectors, naming a node by what separates it from the others of its type.
An attribute does it where the node's own content is distinctive, and a path does it where the content repeats:

```
BinaryExpression[right.value=9]
ConditionalExpression > ArrayExpression.consequent
Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name='safe'] > ArrowFunctionExpression > BlockStatement > TryStatement > BlockStatement > ReturnStatement
```

The middle one is a field selector, `Type.field`, which names which key a node sits under.
It is the only thing that separates the two sides of a ternary, since neither carries content and `nth-child` counts only within a key that holds a list.

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
esmut check <file> --prune        also drop the entries whose selector matches nothing
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
A `cmd` is the one field no stub can write, since nothing in a source file says which suite covers it.

## The loop

```
stub -> read the ops -> run -> fix survivors -> run
```

1. `esmut stub <file>` writes the plan with an op already derived for most sites.
2. Read them, since a derived op says nothing about which mutation is worth testing, and name the ones that matter.
3. `esmut <file>` runs them.
4. Fix each survivor by asserting the behavior it broke, never by deleting the mutation.
5. `esmut check <file>` after a refactor, to see which selectors stopped resolving.
6. `esmut check <file> --prune` once you have read them and know the code is gone rather than moved.

A survivor is the finding.
Deleting the mutation to make a run clean hides the gap it found.

## Pruning

A stale entry names a node no selector reaches any more, and a stale selector still counts toward a
score, so a plan keeping one reports depth for code nobody can mutate.

`check` reports them and writes nothing. `--prune` drops them:

```
esmut check src/rank.ts --prune

  rank.ts
    stale      Literal[value='gone']
    8 resolved, 1 refused
    1 dropped, naming code that is gone
      a behavior nobody can reach
```

Read the report before pruning. A selector goes stale when the code it named was deleted and also
when it merely moved, and only a person can tell those apart. Pruning a moved site throws away the
op and the name somebody wrote for a behavior that still exists, so the entries are printed by name
as they go.

An ambiguous entry is kept. It names a node that is still there, so it is a selector to narrow
rather than work to delete.

## Drift

A selector can still resolve while the node it names has changed, which means the op chosen for it may no longer mean what its author meant.
`stub` reports that as drift, naming the structure the plan recorded and the one there now.

```
esmut stub src/rank.ts

  wrote rank.json
    7 sites
    7 kept, op and name intact
    drifted  IfStatement[test.left.name='kept']
      81ffa987 became fb1eced8
    drifted  BinaryExpression[left.name='kept']
      12360f12 became da19e6fd
```

The op and the name survive, and the plan records the new structure, so the drift is reported once rather than on every later stub.

Drift is judged by structure rather than by source text, so a formatter is not a change.
Rewrapping a line, swapping quote style, and adding a trailing comma all leave the hash alone, where comparing the source would report every reformatted block as drifted.
Changing an operator, a value, or a name does change it.

## Developing

```
deno task test          unit tests, about a second
deno task test:corpus   the fixture sweep, which stubs every file under tests/fixtures
deno task test:all      both
```

esmut is tested with itself.
`.esmut/` holds a plan per source file, and the sweeps have found several bugs in esmut that its own mutations surfaced.
