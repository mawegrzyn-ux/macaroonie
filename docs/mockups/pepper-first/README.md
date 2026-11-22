# Pepper-first back office: interactive mock-ups

Interactive pages that show the UX and UI recommended by the research report
`reports/AI first back office strategy.md` (22 Nov 2026), in Macaroonie's own look. They are the
design mock-ups the owner asked for before un-parking the Pepper-first back office
(`docs/claude/OUTSTANDING.md` item 44, sub-item 11; `docs/PEPPER_FIRST.md`). Published as a
Claude Artifact from this folder. Nothing here is product code: no server, no model, made-up data.

## Files

| File | What it is |
|---|---|
| `index.html` | The page (no doctype / html / head / body: the Artifact publisher adds them). Loads the fonts, `app.css`, `core.js`, each view, then `App.start()` |
| `app.css` | Every style. Shell tokens (`--bg`, `--ink`, `--brand` ...) follow the viewer's theme. Mock-up tokens (`--m-*`) are Macaroonie's admin colours and stay light in both themes |
| `core.js` | `window.App`: the view registry, tabs and `#name` addresses, icons, helpers, the made-up data |
| `views/<name>.js` | One view each: `strategy`, `home`, `ask`, `form`, `confirm`, `review`, `phone`, `registry`, `evidence`, `plan` |
| `tools/shot.mjs` | `node tools/shot.mjs <view> <out dir>`: renders the view at 1280 px, 400 px and dark, saves PNGs, prints console errors and sideways overflow |

## A view

```js
App.view('home', {
  label: 'Home',              // the tab's words
  group: 'Mock-ups',          // 'The answer' | 'Mock-ups' | 'Underneath' | 'Evidence and plan'
  render(root) {              // called once, the first time the tab opens; root is an empty <section class="view">
    root.innerHTML = `...`    // then wire events on what you made
  },
})
```

`views/strategy.js` is the reference: read it first and follow its shape.

A mock-up view is laid out as:

```html
<div class="view-head"><span class="eyebrow">Mock-up</span><h1>...</h1><p class="lede">...</p></div>
<div class="stage">
  ${App.brief({ what, tryThis: [...], why: [{ text, confidence }], status: [{ text, kind }], calls })}
  <div class="stack"> ... controls (.seg, .btn) ... <div class="mock"> ... </div> </div>
</div>
```

## Rules for every view

- **Own file only.** Write `views/<name>.js`. Do not edit `core.js`, `app.css`, `index.html` or another view.
  If you need a style the kit lacks, inject one `<style>` from your view, every selector prefixed with
  your view's id (`#view-home .x`), every colour a token from `app.css` (`var(--m-*)` inside a `.mock`,
  the shell tokens outside). No literal colours, no new fonts.
- **Ids and state.** Prefix every id with a short view prefix (`hm-`, `ask-`). Keep state in closures inside
  `render`. `App.store.get/set` (localStorage, may be unavailable) only for small per-viewer conveniences.
- **No libraries, no network, no build.** Plain ES2019 in a classic script (no `import`, no top-level `await`).
  Nothing may throw on load. Never call `alert`, `confirm` or `prompt`: confirm on the page.
- **It is a mock-up of Macaroonie**, so follow the product's design rules (`CLAUDE.md`, Standard Design Rules):
  touch targets at least 48 px in the mock-up (`.m-btn`, `.m-input` already are), nothing that works only on
  hover, every save explicit with its own Save button, destructive actions asked twice on the page, a phone
  input for numbers uses `inputmode="decimal"` or `"numeric"`, grey page with white cards whose header row is
  `.m-head`. No emojis anywhere: use `App.icon(name)`.
- **Made-up data is marked as an example** once in the view (the group is "Thai House", `App.data`). Use
  `App.data` for venues, people, dishes, suppliers, fridges and tasks so every view tells the same story.
- **Scripted, never pretended.** No model runs. Where Pepper "answers", the answer is scripted from the
  example inputs you offer; an input you have no script for gets a plain "This mock-up only knows the
  examples above" line. Say "target, not built" where the report says so.
- **The page is complete at rest.** A view opens in a realistic working state: filled lists, a sample query,
  an open example. Nothing waits at opacity 0 or needs a click to show its point.
- **Responsive.** The page body must never scroll sideways at 400 px. Wide tables go in `.tblwrap` or
  `.m-scroll`. Flex and grid children that hold text get `min-width: 0`. `.stage` already stacks under 980 px.
- **Both themes.** Outside a `.mock` use only shell tokens. Inside a `.mock` use only `--m-*` tokens.
- **Copy.** Plain, short sentences, the words a restaurant manager uses. Name things by what people
  recognise. A button says what happens ("Save check", "Approve order"). No asides set off by dashes, no
  "not X, but Y" constructions, no scare quotes, no marketing tone. British spelling, GBP.
- **Evidence.** Claims in a brief come from the report; keep its confidence level (`high`, `medium`, `low`)
  and do not strengthen a claim. Link a source only with a URL that is in the report.

## The kit (app.css)

Shell: `.view-head`, `.eyebrow`, `.lede`, `.prose`, `.muted`, `.small`, `.mono`, `.num`, `.stage`,
`.grid.c2`, `.grid.c3`, `.row`, `.stack`, `.spacer`, `.card` (`.flat`, `.tint`), `.brief` (use
`App.brief`), `.tag` (`.high`, `.medium`, `.low`, `.target`, `.built`, `.no`), `.note`, `.btn`
(`.primary`, `aria-pressed`), `.seg` (buttons with `aria-pressed`), `.tblwrap` + `table.tbl`, `dl.kv`,
`pre.code`, `.callcount`, `.list`.

Mock-up: `.mock` (add `.phone` for the phone frame), `App.mockBar(address)`, `.mock-body`,
`App.sidebar(current)`, `.m-main`, `.m-title`, `.m-card`, `.m-head` (+ `.count`), `.m-pad`, `.m-btn`
(`.primary`, `.ghost`, `.danger`, `.sm`), `.m-iconbtn` (`.primary`), `.m-chip` (`.on`, `.why`), `.m-pill`
(`.late`, `.now`, `.ok`, `.info`, `.pepper`), `.m-input`, `.m-select`, `.m-textarea`, `.m-field` (`.filled`
marks a value Pepper filled, `.error` + `.err`), `.m-label`, `.m-form` (`.wide`), `.m-list`, `.m-task`
(`.done`) with `.m-ico` and `.what`, `.m-ask` (the ask bar), `.m-results` + `.m-result` (`.on`, `.pepper`),
`.m-table` (`.r`), `.m-scroll`, `.m-diff` (`<s>` old, `<b>` new), `.m-msg` (`.me`, `.pepper`), `.m-cardlet`
(header / body / footer), `.m-understood`, `.m-scrim` + `.m-sheet` (use `App.sheet`), `.m-toast` (use
`App.toast`), `.m-status`, `.m-bottom`, `.m-hold` (`.rec`).

## App (core.js)

`App.icon(name)` (search, sparkles, mic, camera, check, x, right, down, clock, alert, undo, edit, home,
calendar, users, cash, thermometer, truck, file, list, chart, phone, shield, link, pin, plus, send, store,
utensils, tag, box, lock, eye, star, flag), `App.esc(text)`, `App.el(html)`, `App.money(pence)`,
`App.brief({...})`, `App.toast(mock, text, { undo })`, `App.sheet(mock, { title, body, actions })`,
`App.mockBar(addr)`, `App.sidebar(on)`, `App.go(view)`, `App.store`, `App.data`.

## Checking a view

```bash
cd docs/mockups/pepper-first
node --check views/<name>.js
node tools/shot.mjs <name> <a folder outside the repository>
```

All three lines must say `ok`. Look at the desk and phone PNGs once, fix what is wrong, run again.
