import { assertEquals, assertStringIncludes } from '@std/assert'
import { describe, it } from 'node:test'
import type { Merged } from './plan.ts'
import type { Verdict } from './run.ts'
import { formatCheck, formatMatches, formatPruned, formatStub, formatVerdicts } from './report.ts'
import { type Match, select } from './select.ts'

type Counts = {
  kept?: number
  added?: number
  cmd?: string
  mutations?: Merged['plan']['mutations']
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

      // Several trailing blanks are dropped rather than one, which is what the loop is for.
      // A blank holding whitespace counts as blank, since a row of spaces prints as an empty row.
      assertEquals(formatMatches('x.ts', trailing("'ok'\n\n\n")).split('\n').length, 2)
      assertEquals(formatMatches('x.ts', trailing("'ok'\n  \n\t\n")).split('\n').length, 2)
    })

    // A node whose whole text is blank has no last line holding anything, and dropping every row
    // would print the count with no location under it, leaving a reader nothing to jump to.
    it('prints the location of a node whose text is blank', () => {
      // Arrange
      const blank: Match[] = [{ range: [0, 0], line: 1, column: 0, type: 'Literal', text: '' }]

      // Act
      const printed = formatMatches('x.ts', blank)

      // Assert: the count and one row for the match, rather than the count alone.
      assertEquals(printed.split('\n').length, 2)
      assertStringIncludes(printed, 'x.ts:1:1')
    })

    // A blank line between two lines of a node is content rather than a trailing row, so it stays.
    // Dropping every blank instead of only the trailing ones would close the gap the author wrote.
    it('keeps a blank line that sits between two lines of a node', () => {
      // Arrange
      const spans = select('const a = {\n  b: 1,\n\n  c: 2,\n}\n', 'x.ts', 'ObjectExpression')

      // Act
      const printed = formatMatches('x.ts', spans)

      // Assert: five rows for the count and the four lines the object spans, the blank among them.
      assertEquals(printed.split('\n').length, 6)
      assertStringIncludes(printed, 'b: 1,')
      assertStringIncludes(printed, 'c: 2,')
    })

    // The loop reads the last line to decide, so reading the first instead drops every line of a
    // node whose second line is blank while its last is not. Both keep a node with no blank at all.
    it('decides by the last line rather than the first, which a leading blank tells apart', () => {
      // Arrange
      const range: [number, number] = [0, 1]
      const leading = [{ range, line: 1, column: 0, type: 'Literal', text: "'ok'\n\nb\nc" }]

      // Act
      const printed = formatMatches('x.ts', leading)

      // Assert: nothing is trailing, so every line stays and the blank among them is kept.
      assertEquals(printed.split('\n').length, 5)
      assertStringIncludes(printed, 'b')
      assertStringIncludes(printed, 'c')
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
    // Each count is reported only above zero, so the boundary is what says the line appears at all.
    it('counts the mutations still awaiting an op, and says nothing at none', () => {
      // Arrange
      const waiting = merge({ mutations: [{ at: 'Literal', shape: '400a400a', op: null }] })
      const filled = merge({ mutations: [{ at: 'Literal', shape: '400a400a', op: 'value', to: '200' }] })

      // Act & Assert
      assertStringIncludes(formatStub('plan.json', waiting), '1 awaiting an op')
      assertEquals(formatStub('plan.json', filled).includes('awaiting'), false)

      // Kept and added read the same way, so the boundary is pinned on all three rather than one.
      assertStringIncludes(formatStub('plan.json', merge({ kept: 1 })), '1 kept')
      assertEquals(formatStub('plan.json', merge({ kept: 0 })).includes('kept'), false)
      assertStringIncludes(formatStub('plan.json', merge({ added: 1 })), '1 added')
      assertEquals(formatStub('plan.json', merge({ added: 0 })).includes('added'), false)
    })

    // The site count is what says a stub found anything, so a blank one reads as a file with no sites.
    it('counts the sites it wrote', () => {
      // Arrange
      const two = merge({
        mutations: [
          { at: 'Literal', shape: 'aaaa1111', op: 'value', to: '2' },
          { at: 'IfStatement', shape: 'b78119ea', op: 'invert' },
        ],
      })

      // Act & Assert
      assertStringIncludes(formatStub('plan.json', two), '2 sites')
      assertStringIncludes(formatStub('plan.json', merge()), '0 sites')
    })

    // Each fact sits on its own line, since a report run together is one unreadable string.
    it('prints one fact per line rather than joining them', () => {
      // Arrange
      const several = merge({ kept: 3, added: 2, mutations: [{ at: 'Literal', shape: 'aaaa1111', op: null }] })

      // Act
      const printed = formatStub('plan.json', several)

      // Assert: the header, the count, kept, added, awaiting, and the cmd reminder each get a line.
      assertEquals(printed.split('\n').length, 6)
      assertEquals(printed.includes('sites    '), false)
    })

    // A drifted entry still resolves, so nothing else in the report mentions it. Naming the selector
    // is what sends a reader to the node, and naming both structures is what says it moved.
    it('names a drifted selector and the structures it moved between', () => {
      // Arrange
      const drifted = merge({ drifted: [{ at: "IfStatement[test.left.name='kept']", before: '81ffa987', after: 'fb1eced8' }] })

      // Act
      const printed = formatStub('plan.json', drifted)

      // Assert
      assertStringIncludes(printed, "drifted  IfStatement[test.left.name='kept']")
      assertStringIncludes(printed, '81ffa987 became fb1eced8')
    })

    // Drift is the uncommon case, so a report mentioning it when nothing moved reads as a problem.
    it('says nothing about drift where no entry moved', () => {
      // Act & Assert
      assertEquals(formatStub('plan.json', merge()).includes('drifted'), false)
      assertEquals(formatStub('plan.json', merge()).includes('became'), false)
    })

    // A plan with no cmd cannot run and stub always writes one empty, so the reminder is common.
    it('asks for a cmd while the plan names none', () => {
      // Act & Assert
      assertStringIncludes(formatStub('plan.json', merge()), 'name a cmd before running')
      assertEquals(formatStub('plan.json', merge({ cmd: 'deno test' })).includes('name a cmd'), false)
    })
  })

  describe('formatVerdicts', () => {
    // A killed mutation is expected, so the report names the survivors and tallies the rest.
    it('names a survivor and leaves a killed mutation to the tally', () => {
      // Arrange
      const killed: Verdict = { mutation: { at: 'Literal', shape: 'aaaa1111', op: 'value', to: '2' }, outcome: 'killed' }
      const guard = { at: 'IfStatement', shape: 'b78119ea', op: 'invert' as const, name: 'the guard' }
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
        mutation: { at: 'ReturnStatement', shape: 'eeee0003', op: 'remove' },
        outcome: 'invalid',
        because: "Cannot find name 'a'.",
      }

      // Act & Assert
      assertStringIncludes(formatVerdicts('report.ts', [invalid]), "Cannot find name 'a'.")
    })

    // A tally alone says a mutant was refused without saying which, so the site is named beside it.
    it('names the invalid mutant rather than only tallying it', () => {
      // Arrange
      const invalid: Verdict = {
        mutation: { at: 'ReturnStatement', shape: 'eeee0003', op: 'remove', name: 'the guard is dropped' },
        outcome: 'invalid',
        because: 'it does not compile',
      }

      // Act
      const printed = formatVerdicts('report.ts', [invalid])

      // Assert
      assertStringIncludes(printed, 'invalid   the guard is dropped')
      assertStringIncludes(printed, '1 invalid')
    })

    // A plan holding nothing tallies nothing, and a blank line reads as a run that found no problem.
    it('says nothing was planned rather than printing a blank tally', () => {
      // Act
      const printed = formatVerdicts('report.ts', [])

      // Assert
      assertStringIncludes(printed, 'nothing planned')
      assertEquals(printed.trim().endsWith('nothing planned'), true)
    })
  })

  describe('formatCheck', () => {
    // A selector resolving to one node needs no report, so only the refusals are named.
    it('names a stale and an ambiguous selector and counts what resolved', () => {
      // Arrange
      const resolved = [
        // Three resolving against one of each refusal, which is the only shape where the refused
        // count differs for every number the check could compare against and for either sense of
        // the comparison. Two resolving makes counting the refused agree with counting the resolved.
        { mutation: { at: 'Literal[value=1]', shape: 'aaaa1111', op: null }, matches: 1, excused: false },
        { mutation: { at: 'Literal[value=7]', shape: 'bbbb7777', op: null }, matches: 1, excused: false },
        { mutation: { at: 'Literal[value=9]', shape: 'cccc9999', op: null }, matches: 1, excused: false },
        { mutation: { at: 'Gone', shape: 'eeee0004', op: null }, matches: 0, excused: false },
        { mutation: { at: 'Literal', shape: 'eeee0005', op: null }, matches: 3, excused: false },
      ]

      // Act
      const printed = formatCheck('report.ts', resolved)

      // Assert
      assertStringIncludes(printed, 'stale')
      assertStringIncludes(printed, 'ambiguous  Literal')
      assertStringIncludes(printed, '5 resolved, 2 refused')
      assertEquals(printed.includes('Literal[value=1]'), false)
      assertEquals(printed.includes('Literal[value=7]'), false)
      assertEquals(printed.split('\n').length, 4)
    })

    // An excused entry resolves like any other, so saying only the count would read as healthy.
    it('names an excused selector apart from the count of what resolved', () => {
      // Arrange
      const resolved = [
        { mutation: { at: 'Literal[value=1]', shape: 'aaaa1111', op: null }, matches: 1, excused: false },
        { mutation: { at: 'Marked', shape: 'bbbb2222', op: null }, matches: 1, excused: true },
      ]

      // Act
      const printed = formatCheck('report.ts', resolved)

      // Assert
      assertStringIncludes(printed, 'excused    Marked')
      assertStringIncludes(printed, '2 resolved, 0 refused, 1 excused')
      assertEquals(printed.includes('Literal[value=1]'), false)
    })
  })

  describe('formatPruned', () => {
    // A prune deletes an op and a name somebody wrote, so the print is the only record of it.
    // Each dropped entry gets its own row, since a reader scans the list for work they recognise.
    // Joined onto one line, two names read as one and the count no longer matches what is shown.
    it('prints one dropped entry per line', () => {
      // Arrange
      const dropped = [
        { at: 'Gone', shape: 'eeee0004', op: 'remove' as const, name: 'the first' },
        { at: 'Also', shape: 'eeee0005', op: 'remove' as const, name: 'the second' },
      ]

      // Act
      const printed = formatPruned(dropped, 0)

      // Assert: the header and one row each, so three lines rather than one.
      assertEquals(printed.split('\n').length, 3)
      assertStringIncludes(printed, '2 dropped')
    })

    it('names a dropped entry by what its author called it', () => {
      // Arrange
      const dropped = [{ at: 'Gone', shape: 'eeee0004', op: 'remove' as const, name: 'the guard nobody tests' }]

      // Act
      const printed = formatPruned(dropped, 0)

      // Assert
      assertStringIncludes(printed, '1 dropped')
      assertStringIncludes(printed, 'the guard nobody tests')
    })

    // An entry nobody named has only its selector, which still says which site was lost.
    it('falls back to the selector where the entry carries no name', () => {
      // Arrange
      const dropped = [{ at: "Literal[value='gone']", shape: 'eeee0005', op: null }]

      // Act
      const printed = formatPruned(dropped, 0)

      // Assert
      assertStringIncludes(printed, "Literal[value='gone']")
    })

    // The two reasons read differently, since one names code that left and one code that stayed.
    it('counts an excused drop apart from a stale one', () => {
      // Arrange
      const dropped = [
        { at: 'Gone', shape: 'eeee0004', op: 'remove' as const },
        { at: 'Marked', shape: 'eeee0005', op: 'remove' as const },
      ]

      // Act
      const printed = formatPruned(dropped, 1)

      // Assert
      assertStringIncludes(printed, '2 dropped, 1 naming code that is gone and 1 excused by a marker')
    })
  })
})
