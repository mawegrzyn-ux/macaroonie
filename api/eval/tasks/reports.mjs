// Questions about the figures (Pepper-first step 8A2): one answerable only
// through another word for a figure (the catalogue's synonyms), one no report
// holds, which must be answered "not covered" and never worked out another
// way. Graded by what Pepper's reading tools returned, never by its words.

const COVERS = /^(guests|covers)\b/

export const tasks = [
  {
    id: 'covers_by_slang',
    area: 'reports',
    why: 'Staff say "pax" or "heads" for covers; until the catalogue had synonyms no report matched the word (step 8A2).',
    say: ctx => 'How many pax did we do at ' + ctx.venue.name + ' last week?',
    expect: 'answer',
    async check(ctx, chat) {
      const found = chat.calls.filter(c => c.name === 'find_fields' && !c.result?.error)
      if (!found.length) return 'find_fields wasn\'t asked'
      const lines = found.flatMap(c => (c.result.subjects || []).flatMap(s => s.matching || []))
      if (!lines.some(l => COVERS.test(l))) return 'find_fields found no covers figure for the words asked: ' + JSON.stringify(lines.slice(0, 4))
      const asked = chat.calls.filter(c => c.name === 'ask_data' && !c.result?.error)
      if (!asked.length) return 'ask_data didn\'t answer it'
      const figures = asked.flatMap(c => (c.input?.plan?.figures || []).map(f => f.figure || f.field || ''))
      if (!figures.some(f => COVERS.test(f))) return 'the answer counted ' + JSON.stringify(figures) + ', not covers'
      return true
    },
    reference: ctx => [
      { tool: 'find_fields', input: { topic: 'pax last week' } },
      { tool: 'ask_data', input: { plan: { subject: 'till.checks', figures: [{ figure: 'guests' }], period: { relative: 'last_week' }, venues: [ctx.venue.name] } } },
    ],
  },
  {
    id: 'not_in_reports',
    area: 'reports',
    why: 'A question no report holds must get "not covered" with the nearest fields, never a guess (step 8A2; the strategy\'s step 8 measure).',
    say: () => 'What was our carbon footprint last month?',
    expect: 'answer',
    async check(ctx, chat) {
      const found = chat.calls.filter(c => c.name === 'find_fields' && !c.result?.error)
      if (!found.some(c => c.result.covered === false)) return 'find_fields didn\'t say it isn\'t covered: ' + JSON.stringify(found.map(c => c.input))
      const guessed = chat.calls.filter(c => ['ask_data', 'run_report', 'build_report'].includes(c.name)).map(c => c.name)
      return guessed.length ? 'it worked a figure out anyway: ' + guessed.join(', ') : true
    },
    reference: () => [{ tool: 'find_fields', input: { topic: 'carbon footprint last month' } }],
  },
]
