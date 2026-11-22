# Pepper's evaluation set

Step 0 of the Pepper-first plan (`reports/AI first back office strategy.md`, "0. Prove and
instrument"): simple tasks typed to Pepper, each graded by the state of the database
afterwards, never by what Pepper says, each trial from a clean tenant (Anthropic, "Demystifying
evals for AI agents").

- `harness.mjs`: makes a clean tenant (empties the test database, then `resetAndSeed()` and
  `fillTenant()` from `api/test/support/` with the mark "Oak": venues "Oak Ware" and
  "Oak Hertford", the fridge "Oak Walk-in", "Oak Jo Bloggs", the menu "Oak Lunch" with
  "Oak Pad Thai", the supplier "Oak Fresh Co"), runs the task's setup, sends its message(s)
  to Pepper's real chat (`POST /api/ai/chat`), presses Confirm (or Cancel) on every card as a
  person would, then checks the end state. Tokens, cost and time per trial come from Pepper's
  record of model requests (`ai_requests`).
- `tasks/<area>.mjs`: the tasks, 27 of them, 7 where the right end state is "nothing
  changed" (Pepper must ask, refuse, or answer without changing anything).
- `run.mjs`: the command line. Writes a JSON result to `eval/results/` (not committed).

It lives in `api/eval/` rather than `api/test/`: `npm test` runs every `test/*.test.mjs` on
each pull request, and a live run is a measurement the owner starts on purpose.
`api/test/pepper-eval.test.mjs` proves the harness in CI with the stand-in model
(`test/support/fake-claude.mjs`): it replays each task's reference calls and every check must
pass, a change task's check must fail before anything is asked, and a wrong end state must fail.

## Adding a task

Add an object to the file of its area (or a new file, listed in `loadTasks()`):

```js
{
  id: 'fridge_reading',                       // unique
  area: 'safety',
  why: 'Where it comes from: a real failure, a rule, a common job.',
  as: 'operator',                             // optional: who types it (default owner)
  async setup(ctx) { /* rows it needs, through ctx.owner (the API) where it can */ },
  say: ctx => 'The walk-in fridge at ' + ctx.venue.name + ' is reading 3 degrees.',
  cards: 'confirm',                           // or 'cancel'
  expect: 'change',                           // or 'nothing' with watch: ['table', ...]
  async check(ctx) { /* true, or a sentence saying what is wrong */ },
  reference: ctx => [{ tool: 'log_temperature', input: { venue_id: ctx.venue.id, fridge: 'Walk-in', temperature_c: 3 } }],
}
```

- Draw it from a real failure where you can (a chat that went wrong, an entry in
  `docs/claude/areas/pepper.md`), and say so in `why`.
- Check the data, not the reply: the row exists, at the right venue, day and value, and
  nothing else changed that shouldn't have (`cancel_booking` also checks the other guest).
- `reference` is what a right answer does: the stand-in model makes exactly those calls in the
  test. Run `node --import ./test/support/register.mjs --test --test-force-exit test/pepper-eval.test.mjs`
  in `api/` (about 90 seconds): the task must pass with it and its check must fail before it.
- A "nothing" task watches whole tables, or only the columns that matter where work in the
  background touches a row (`'bookings:id,status,starts_at,...'`: a booking's emails set
  columns of their own).
- Dates: `ctx.today`, `ctx.day(n)` (n days ahead, skipping the days the test schedule is
  closed), `spoken(ymd)` for "Monday 23 November"; times at the venue with `localTime()`.

## Running it

From the repo root, a test database of its own (the harness empties it for every trial):

```bash
eval "$(scripts/test-env.sh eval)"
cd api
npm run eval                      # no model: every setup and check, a change task must fail
npm run eval -- --live            # the real model: costs money, see below
npm run eval -- --live --only=book_table,fridge_reading --trials=3
```

`--live` needs `ANTHROPIC_API_KEY` set to a real key in the environment (the test database has
no key saved on the Platform page); without `--live` the key is ignored and no model is called.
The models are the API's own `AI_MODEL` (main, default `claude-opus-5-5`) and `AI_MODEL_FAST`
(the everyday model, default `claude-haiku-5-5`; set it empty to run every chat on the main
model). The result file lists per trial: pass, the reason when it failed, Pepper's reply, the
tools it called, the cards and how they ended, model requests, tokens, cost and time; and the
run's totals, with `tasks_always_passed` for pass^k when `--trials` is above 1.

## What a run costs

Estimates, before the first live run; the result file has the real figure. Every chat request
sends Pepper's system prompt and its core tools (some 15,000 to 25,000 tokens, read from the
prompt cache after the first), and a task takes two to five requests. On the default routing
(chats start on Haiku 5.5 at $0.10 / $0.50 a million tokens in / out) that is about
$0.005 to $0.02 a task, so **about $0.15 to $0.60 for the 27 tasks**. A chat that moves up to
Opus 5.5 ($4 / $20) costs about 40 times as much, so with `AI_MODEL_FAST` empty (every chat on
Opus) reckon **$5 to $15 a run**, and multiply by `--trials`. A run takes some 5 to 15 minutes
(each trial fills a clean tenant in about 4 seconds, then the model's own time).
