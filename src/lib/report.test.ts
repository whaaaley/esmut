import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from 'node:test'
import type { Merged } from './plan.ts'
import type { Verdict } from './run.ts'
import { formatCheck, formatMatches, formatStub, formatVerdicts } from './report.ts'
import { type Match, select } from './select.ts'

type Counts = {
  kept?: number
  added?: number
  cmd?: string
  mutations?: Merged['plan']['mutations']
  skipped?: Merged['plan']['skipped']
  stale?: Merged['stale']
  drifted?: Merged['drifted']
}

// A plan with nothing in it, which each test fills only where its own behavior reads.
const merge = (counts: Counts = {}): Merged => ({
  kept: counts.kept ?? 0,
  added: counts.added ?? 0,
  stale: counts.stale ?? [],
  drifted: counts.drifted ?? [],
  plan: {
    source: 'safe.utils.ts',
    cmd: counts.cmd ?? '',
    mutations: counts.mutations ?? [],
    skipped: counts.skipped ?? [],
  },
})

describe('All Report Tests', () => {
  describe('formatMatches', () => {
    // A location is printed for a reader going to it, and an editor counts the first column as one.
    // ESTree counts the first column as zero while the first line is one, so the column is offset.
    it('counts the first column as one, the way the editor a reader jumps to does', () => {
      // Arrange
      const source = "const key = '[unset]'\n"
      const matches = select(source, 'redact.ts', "Literal[value='[unset]']")

      // Act
      const printed = formatMatches('redact.ts', matches)

      // Assert: the literal opens at column 13 counting from one, where an editor puts the cursor.
      assertEquals(source.indexOf("'[unset]'") + 1, 13)
      assertStringIncludes(printed, 'redact.ts:1:13')
    })

    // The count is the verdict: nothing matched is stale, one is usable, more is ambiguous.
    // A single match reads as singular, which a substring check misses: match prefixes matches.
    it('counts one match in the singular and every other number in the plural', () => {
      // Arrange
      const source = "const key = '[unset]'\nconst other = '[unset]'\n"
      const two = select(source, 'redact.ts', "Literal[value='[unset]']")

      // Act
      const [head] = formatMatches('redact.ts', two.slice(0, 1)).split('\n')

      // Assert
      assertEquals(head, '  1 match')
      assertEquals(formatMatches('redact.ts', []), '  0 matches')
      assertStringIncludes(formatMatches('redact.ts', two), '  2 matches')
    })
  })

  describe('asLines', () => {
    // A reader deciding whether a site is the one they meant needs every line of it.
    // The lines stay apart rather than joined, which would read as source that does not parse.
    it('prints every line of a node that spans several', () => {
      // Arrange
      const spans = select('const a = {\n  b: 1,\n}\n', 'x.ts', 'ObjectExpression')

      // Act
      const printed = formatMatches('x.ts', spans)

      // Assert: all three lines of the object survive, and nothing marks a truncation.
      assertStringIncludes(printed, '{')
      assertStringIncludes(printed, 'b: 1,')
      assertStringIncludes(printed, '}')
      assertEquals(printed.includes('...'), false)
    })

    // The continuation lines sit under the first, so the position column stays readable.
    // Each keeps the indentation it had in the source, which is what makes the block read as code.
    it('indents the lines after the first to where the first one starts', () => {
      // Arrange
      const spans = select('const a = {\n  b: 1,\n}\n', 'x.ts', 'ObjectExpression')

      // Act
      const [, head = '', second = '', third = ''] = formatMatches('x.ts', spans).split('\n')

      // Assert: the closing brace sits under the opening one, and the field keeps its indent.
      const column = head.indexOf('{')
      assertEquals(third.search(/\S/), column)
      assertEquals(second.search(/\S/), column + 2)
    })

    it('leaves a node that fits one line alone', () => {
      // Arrange
      const fits = select("const a = 'ok'\n", 'x.ts', 'Literal')

      // Act
      const [, fitting = ''] = formatMatches('x.ts', fits).split('\n')

      // Assert
      assertEquals(fitting.trim().endsWith("'ok'"), true)
    })

    // A trailing newline carries nothing, so printing it would add a blank row per match.
    it('drops the blank lines trailing a node rather than printing them', () => {
      // Arrange
      const trailing = (text: string): Match[] => {
        const range: [number, number] = [0, text.length]
        return [{ range, line: 1, column: 0, type: 'Literal', text }]
      }

      // Act
      const newline = formatMatches('x.ts', trailing("'ok'\n"))
      const spaces = formatMatches('x.ts', trailing("'ok'  "))

      // Assert: the whole node is printed on one row, with no empty row under it.
      assertEquals(newline.split('\n').length, 2)
      assertStringIncludes(newline, "'ok'")
      assertEquals(spaces.split('\n').length, 2)
      assertStringIncludes(spaces, "'ok'")
    })
  })

  describe('formatStub', () => {
    // Each count is reported only when there is something to report, so a first stub says none.
    it('names what it kept only when it kept something', () => {
      // Act & Assert
      assertStringIncludes(formatStub('plan.json', merge({ kept: 3 })), '3 kept, op and name intact')
      assertEquals(formatStub('plan.json', merge()).includes('kept'), false)
    })

    it('names what it added only when it added something', () => {
      // Act & Assert
      assertStringIncludes(formatStub('plan.json', merge({ added: 2 })), '2 added')
      assertEquals(formatStub('plan.json', merge()).includes('added'), false)
    })

    // An unfilled op is the one thing a stub leaves for a person, so the line counts them.
    it('counts the mutations still awaiting an op', () => {
      // Arrange
      const waiting = merge({ mutations: [{ at: 'Literal', was: '400', op: null }] })
      const filled = merge({ mutations: [{ at: 'Literal', was: '400', op: 'value', to: '200' }] })

      // Act & Assert
      assertStringIncludes(formatStub('plan.json', waiting), '1 awaiting an op')
      assertEquals(formatStub('plan.json', filled).includes('awaiting'), false)
    })

    it('names the sites it could not address only when it skipped one', () => {
      // Arrange
      const skipped = merge({ skipped: [{ was: 'data: fn()', line: 9, column: 13, ops: ['remove'] }] })

      // Act & Assert
      assertStringIncludes(formatStub('plan.json', skipped), '1 with no unique selector')
      assertEquals(formatStub('plan.json', merge()).includes('no unique selector'), false)
    })

    // A plan with no cmd cannot run and stub always writes one empty, so the reminder is common.
    it('asks for a cmd while the plan names none', () => {
      // Act & Assert
      assertStringIncludes(formatStub('plan.json', merge()), 'name a cmd before running')
      assertEquals(formatStub('plan.json', merge({ cmd: 'deno test' })).includes('name a cmd'), false)
    })

    // A skipped site is printed so its position can be hand-anchored, as formatMatches serves.
    // The two printers offset the column separately, so one can regress while the other is right.
    it('counts a skipped column from one, the same way a match is counted', () => {
      // Arrange
      const merged: Merged = {
        plan: {
          source: 'safe.utils.ts',
          cmd: '',
          mutations: [],
          skipped: [{ was: 'data: fn()', line: 9, column: 13, ops: ['remove'] }],
        },
        kept: 0,
        added: 0,
        stale: [],
        drifted: [],
      }

      // Act
      const printed = formatStub('safe.utils.mut.json', merged)

      // Assert: the plan stores the column ESTree gave, and the print adds what an editor counts.
      assertStringIncludes(printed, 'safe.utils.ts:9:14')

      // Each fact sits on its own line, since a report run together is one unreadable string.
      assertEquals(printed.split('\n').length, 5)
    })
  })

  describe('formatVerdicts', () => {
    // A killed mutation is expected, so the report names the survivors and tallies the rest.
    it('names a survivor and leaves a killed mutation to the tally', () => {
      // Arrange
      const killed: Verdict = { mutation: { at: 'Literal', was: '1', op: 'value', to: '2' }, outcome: 'killed' }
      const guard = { at: 'IfStatement', was: 'if (a)', op: 'invert' as const, name: 'the guard' }
      const survived: Verdict = { mutation: guard, outcome: 'survived' }

      // Act
      const printed = formatVerdicts('report.ts', [killed, survived])

      // Assert
      assertStringIncludes(printed, 'survived  the guard')
      assertEquals(printed.includes('killed  '), false)
      assertStringIncludes(printed, '1 killed, 1 survived')
      assertEquals(printed.split('\n').length, 3)
    })

    // An invalid mutant never ran, so the reason it would not compile is what the reader needs.
    it('says why an invalid mutant was refused', () => {
      // Arrange
      const invalid: Verdict = {
        mutation: { at: 'ReturnStatement', was: 'return a', op: 'remove' },
        outcome: 'invalid',
        because: "Cannot find name 'a'.",
      }

      // Act & Assert
      assertStringIncludes(formatVerdicts('report.ts', [invalid]), "Cannot find name 'a'.")
    })
  })

  describe('formatCheck', () => {
    // A selector resolving to one node needs no report, so only the refusals are named.
    it('names a stale and an ambiguous selector and counts what resolved', () => {
      // Arrange
      const resolved = [
        { mutation: { at: 'Literal[value=1]', was: '1', op: null }, matches: 1 },
        { mutation: { at: 'Gone', was: 'x', op: null }, matches: 0 },
        { mutation: { at: 'Literal', was: 'y', op: null }, matches: 3 },
      ]

      // Act
      const printed = formatCheck('report.ts', resolved)

      // Assert
      assertStringIncludes(printed, 'stale')
      assertStringIncludes(printed, 'ambiguous  Literal')
      assertStringIncludes(printed, '3 resolved, 2 refused')
      assertEquals(printed.includes('Literal[value=1]'), false)
      assertEquals(printed.split('\n').length, 4)
    })
  })
})
