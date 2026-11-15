// Reports as PDFs (docs/REPORTS.md 13, decision 3; src/services/pdfBrowser.js):
// a PDF is the report's print page, by its layout, made into a file by a
// browser on the server. A download, a kept file, a page of reports and an
// email's attachment all come from that one page; a server with no browser
// says so before anything runs, and a browser that fails is a plain refusal
// (or, for an email, a note in the message).
//
// The browser here is a stand-in named by PDF_BROWSER_PATH: a script that
// writes "%PDF-1.4" and then the page it was given, so a test can read what
// the page said. A machine's own Chrome is never used (it differs from one
// machine to the next), so every test sets the path itself.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { as, ok, closeApp, sql, getApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { sellTwoDays } from './support/tillDays.mjs'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../src/middleware/auth.js'
import { env } from '../src/config/env.js'
import { htmlToPdf, pdfAvailable, forgetPdfBrowser } from '../src/services/pdfBrowser.js'
import { forgetReportResults } from '../src/reports/run.js'

const DAY = 'starter:till_sales_by_day'
const SERVERS = 'starter:till_sales_by_server'
const LOCK = path.join(os.tmpdir(), 'macaroonie-pdf.lock')
const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'
const NO_BROWSER = /This server can(&#39;|')t make PDFs yet/
const hadPath = process.env.PDF_BROWSER_PATH
const realFetch = globalThis.fetch
const mails = []
let ids, t, owner, operator, viewer, ownerB, today, userId, dir, standIn, failing, notPdf, logoFile

/** A reply with its bytes, as someone. */
async function raw(sub, tenantId, method, url, body) {
  const app = await getApp()
  const res = await app.inject({
    method, url,
    headers: {
      authorization: 'Bearer test:' + sub, 'x-tenant-id': tenantId,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
    },
    payload: body !== undefined ? JSON.stringify(body) : undefined,
  })
  return { status: res.statusCode, headers: res.headers, bytes: res.rawPayload, text: res.body }
}

/** The browser the server has, from now on (a path that isn't there: none). */
function useBrowser(file) {
  process.env.PDF_BROWSER_PATH = file
  forgetPdfBrowser()
}
function script(name, body) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, '#!/bin/sh\n' + body + '\n', { mode: 0o755 })
  return file
}

/** A stand-in PDF: checked to be one, then the page the browser was given. */
function pageOf(bytes) {
  const text = Buffer.from(bytes).toString('utf8')
  assert.ok(text.startsWith('%PDF-1.4\n'), 'a PDF: ' + text.slice(0, 80))
  return text.slice('%PDF-1.4\n'.length)
}
const count = (html, piece) => html.split(piece).length - 1
const runs = () => sql`SELECT * FROM report_runs WHERE tenant_id = ${ids.a}`
async function recorded(fn) {
  const had = new Set((await runs()).map(r => r.id))
  const out = await fn()
  return { out, made: (await runs()).filter(r => !had.has(r.id)) }
}
const files = () => sql`SELECT count(*)::int AS n FROM report_files WHERE tenant_id = ${ids.a}`.then(r => r[0].n)
const exportPdf = (ref, body = {}) => raw(A.owner, ids.a, 'POST', '/api/reports/' + ref + '/export', { format: 'pdf', params: { period: today }, ...body })
const htmlOf = m => m.body.content.find(c => c.type === 'text/html')?.value || ''
const attachmentOf = m => m.body.attachments?.[0] || null
const sendNow = body => owner.post('/api/reports/' + DAY + '/send', {
  params: { period: { relative: 'today' }, venues: [t.V] }, delivery: { in_message: true, attach: 'pdf' },
  recipients: [{ user_id: userId[A.owner] }], ...body,
})

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a, { reports: false })
  assert.deepEqual(filled.failed, [], 'fixtures: ' + JSON.stringify(filled.failed).slice(0, 600))
  owner = as(A.owner, ids.a)
  operator = as(A.operator, ids.a)
  viewer = as(A.viewer, ids.a)
  ownerB = as(B.owner, ids.b)
  t = await sellTwoDays({ owner, tenantId: ids.a, filled })
  today = { from: t.date, to: t.date }
  userId = Object.fromEntries((await sql`SELECT auth0_user_id, id::text AS id FROM users WHERE tenant_id = ${ids.a}`).map(u => [u.auth0_user_id, u.id]))

  // The stand-in browsers: one that prints, one that stops, one that writes something that isn't a PDF.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macaroonie-pdf-test-'))
  const args = 'out=""; page=""\nfor a in "$@"; do\n  case "$a" in\n    --print-to-pdf=*) out="${a#--print-to-pdf=}" ;;\n    file://*) page="${a#file://}" ;;\n  esac\ndone\n[ -n "$out" ] || exit 2'
  standIn = script('prints', args + '\n{ printf \'%%PDF-1.4\\n\'; cat "$page"; } > "$out"')
  failing = script('stops', 'exit 3')
  notPdf = script('writes-words', args + '\nprintf \'not a pdf\' > "$out"')
  useBrowser(standIn)

  // The venue sends email through SendGrid (a stand-in).
  await ok(owner.post('/api/email-templates/settings/' + t.V, {
    email_provider: 'sendgrid', provider_api_key: 'SG.pdf-test', from_name: 'Ware kitchen', from_email: 'hello@ware.example',
  }), 'email settings')
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.sendgrid.com/')) {
      mails.push({ body: JSON.parse(opts.body) })
      return new Response('', { status: 202, headers: { 'x-message-id': 'sg' + mails.length } })
    }
    return realFetch(url, opts)
  }
})
after(async () => {
  globalThis.fetch = realFetch
  if (hadPath === undefined) delete process.env.PDF_BROWSER_PATH
  else process.env.PDF_BROWSER_PATH = hadPath
  forgetPdfBrowser()
  if (logoFile) fs.rmSync(path.dirname(logoFile), { recursive: true, force: true })
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
  await closeApp()
})
beforeEach(() => {
  mails.length = 0
  forgetReportResults()
  if (standIn) useBrowser(standIn)
})

test('a PDF download is the report\'s print page by its layout, made into a file, and recorded as a file made', async () => {
  assert.equal(pdfAvailable(), true)
  assert.equal((await ok(owner.get('/api/reports'))).can_pdf, true)
  assert.equal((await ok(owner.get('/api/reports/' + DAY))).report.can_pdf, true)

  const first = await recorded(() => exportPdf(DAY))
  const res = first.out
  assert.equal(res.status, 200, res.text.slice(0, 200))
  assert.equal(res.headers['content-type'], 'application/pdf')
  assert.match(res.headers['content-disposition'], /^attachment; filename="sales-by-day-\d{4}-\d{2}-\d{2}\.pdf"$/)
  const page = pageOf(res.bytes)
  // The print page, as a file: its name, the group, the chart and the table, who made it.
  assert.ok(page.includes('<h1>Sales by day</h1>'))
  assert.ok(page.includes('<p class="who">Thai House</p>'))
  assert.equal(count(page, '<figure class="chart">'), 1)
  assert.equal(count(page, '<table>'), 1)
  assert.ok(page.includes('<dt>Period</dt>'))
  assert.match(page, /Made by a-owner@test\.local/)
  assert.equal(/Printed by/.test(page), false)
  // A page that fetches and runs nothing, on real paper.
  assert.ok(page.includes(CSP), 'the page\'s own policy')
  assert.equal(page.includes('<script'), false)
  assert.equal(page.includes('id="print"'), false, 'no print bar')
  assert.match(page, /@page\{size:A4 /, 'a file needs a paper size')

  assert.equal(first.made.length, 1)
  const [run] = first.made
  assert.deepEqual([run.kind, run.format, run.starter_key, run.error, run.user_sub], ['export', 'pdf', 'till_sales_by_day', null, A.owner])
  assert.ok(run.row_count >= 1)
  assert.equal(fs.existsSync(LOCK), false, 'the machine\'s turn is handed back')

  // What the screen was showing: the table left off under the chart.
  const chartOnly = pageOf((await exportPdf(DAY, { table: false })).bytes)
  assert.equal(count(chartOnly, '<figure class="chart">'), 1)
  assert.equal(count(chartOnly, '<table>'), 0)

  // The group's layout: its paper, its way round, its words at the foot.
  const layout = (await ok(owner.post('/api/reports/layouts', {
    name: 'Letter', settings: { page: { size: 'letter', way: 'landscape' }, footer: { text: 'In confidence' }, header: { run: false } },
  }), 'layout')).layout
  await ok(owner.put('/api/reports/layouts/' + layout.id, { is_default: true }), 'the default')
  const laid = pageOf((await exportPdf(DAY)).bytes)
  assert.match(laid, /@page\{size:letter landscape;/)
  assert.ok(laid.includes('In confidence'))
  assert.equal(/Made by/.test(laid), false, 'the layout leaves out who made it')
  await ok(owner.delete('/api/reports/layouts/' + layout.id), 'layout gone')

  // Who may: a download needs Use on Reports.
  assert.equal((await raw(A.operator, ids.a, 'POST', '/api/reports/' + DAY + '/export', { format: 'pdf' })).status, 403)
  assert.equal((await raw(A.viewer, ids.a, 'POST', '/api/reports/' + DAY + '/export', { format: 'pdf' })).status, 403)
})

test('the group\'s logo is in a PDF only as data, and only a file of ours: the server\'s browser fetches nothing', async () => {
  const setLogo = async url => {
    const rows = await sql`UPDATE tenant_site SET logo_url = ${url} WHERE tenant_id = ${ids.a} RETURNING tenant_id`
    assert.equal(rows.length, 1, 'the group has a site row')
  }
  // A real picture of ours.
  const folder = path.join(env.UPLOAD_DIR, 'pdf-test-' + ids.a)
  fs.mkdirSync(folder, { recursive: true })
  logoFile = path.join(folder, 'logo.png')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
  fs.writeFileSync(logoFile, png)
  await setLogo('/uploads/pdf-test-' + ids.a + '/logo.png')
  const ours = pageOf((await exportPdf(DAY)).bytes)
  assert.ok(ours.includes('<img src="data:image/png;base64,' + png.toString('base64') + '" alt="">'), 'our own file, as data')

  // An address someone typed, a path that climbs out, a file that isn't a picture, one that isn't there: no logo.
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'words')
  for (const url of [
    'https://logos.example/logo.png',
    '/uploads/../../../../etc/hostname.png',
    '/uploads/pdf-test-' + ids.a + '/notes.txt',
    '/uploads/pdf-test-' + ids.a + '/missing.png',
    'file:///etc/hostname',
  ]) {
    await setLogo(url)
    const page = pageOf((await exportPdf(DAY)).bytes)
    assert.equal(page.includes('<img'), false, url)
    assert.equal(page.includes('logos.example'), false, url)
    assert.ok(page.includes('<h1>Sales by day</h1>'), 'the report is still there: ' + url)
  }
  // The print page in a person's own browser still names an https logo (their browser fetches it, not ours).
  await setLogo('https://logos.example/logo.png')
  const link = await ok(owner.post('/api/reports/' + DAY + '/print-link', { params: { period: today } }), 'print link')
  const app = await getApp()
  const printed = await app.inject({ method: 'GET', url: link.path, headers: { [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET } })
  assert.ok(printed.body.includes('<img src="https://logos.example/logo.png" alt="">'))
  await setLogo(null)
})

test('a kept PDF is the download, kept with the other files and listed on Past runs', async () => {
  const before = await files()
  const kept = await recorded(() => owner.post('/api/reports/' + DAY + '/files', { format: 'pdf', params: { period: today } }))
  assert.equal(kept.out.status, 201, kept.out.body.slice(0, 300))
  const file = kept.out.json.file
  assert.equal(file.format, 'pdf')
  assert.match(file.name, /^sales-by-day-\d{4}-\d{2}-\d{2}\.pdf$/)
  assert.equal(file.personal, false)
  assert.ok(file.rows >= 1)
  assert.equal(await files(), before + 1)
  const [row] = await sql`SELECT storage_key, content_type, bytes FROM report_files WHERE id = ${file.id}`
  assert.match(row.storage_key, /^reports\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.pdf$/)
  assert.equal(row.content_type, 'application/pdf')

  const got = await raw(A.owner, ids.a, 'GET', file.path)
  assert.equal(got.status, 200, got.text.slice(0, 200))
  assert.equal(got.headers['content-type'], 'application/pdf')
  assert.equal(got.headers['content-disposition'], 'attachment; filename="' + file.name + '"')
  assert.equal(Number(row.bytes), got.bytes.length)
  const page = pageOf(got.bytes)
  assert.ok(page.includes('<h1>Sales by day</h1>'))
  assert.ok(page.includes(CSP))

  assert.equal(kept.made.length, 1)
  assert.deepEqual([kept.made[0].kind, kept.made[0].format, kept.made[0].error], ['export', 'pdf', null])
  const listed = (await ok(owner.get('/api/reports/runs?file=' + file.id))).runs
  assert.equal(listed.length, 1)
  assert.equal(listed[0].what, 'kept')
  assert.equal(listed[0].file.format, 'pdf')
  // Someone else's file is never theirs to download.
  assert.equal((await ownerB.get(file.path)).status, 404)
})

test('a page of reports as a PDF: one file, with a file made recorded for each of its reports', async () => {
  const page = (await ok(owner.post('/api/reports', {
    name: 'Monday pack',
    spec: {
      kind: 'page', period: today,
      blocks: [
        { type: 'report', ref: DAY, title: 'Sales by day' },
        { type: 'text', title: 'Notes', text: 'Line one' },
        { type: 'report', ref: SERVERS, title: 'By server', show: 'table' },
      ],
    },
  }), 'page')).report
  assert.equal(page.can_pdf, true)

  const made = await recorded(() => raw(A.owner, ids.a, 'POST', '/api/reports/' + page.id + '/export', { format: 'pdf' }))
  const res = made.out
  assert.equal(res.status, 200, res.text.slice(0, 200))
  assert.equal(res.headers['content-type'], 'application/pdf')
  assert.match(res.headers['content-disposition'], /^attachment; filename="monday-pack-\d{4}-\d{2}-\d{2}\.pdf"$/)
  const html = pageOf(res.bytes)
  assert.ok(html.includes('<h1>Monday pack</h1>'))
  assert.ok(html.includes('<section class="block"><h2>Sales by day</h2>'))
  assert.ok(html.includes('<section class="block text"><h2>Notes</h2>'))
  assert.ok(html.includes('<section class="block"><h2>By server</h2>'))
  assert.equal(count(html, '<dt>Period</dt>'), 1, 'the page\'s period, said once')
  assert.ok(html.includes(CSP))
  assert.equal(html.includes('<script'), false)
  assert.match(html, /Made by a-owner@test\.local/)

  assert.equal(made.made.length, 2, 'a file made for each report')
  for (const r of made.made) assert.deepEqual([r.kind, r.format, r.error, r.report_id], ['export', 'pdf', null, null])
  assert.deepEqual(made.made.map(r => r.starter_key).sort(), ['till_sales_by_day', 'till_sales_by_server'])

  // The visitor's own period; a page is still never a CSV or a kept file.
  const then = pageOf((await raw(A.owner, ids.a, 'POST', '/api/reports/' + page.id + '/export', { format: 'pdf', period: { from: '2020-01-01', to: '2020-01-02' } })).bytes)
  assert.equal(count(then, 'Rows: 0</p>'), 2, 'nothing sold in the visitor\'s period')
  assert.equal((await owner.post('/api/reports/' + page.id + '/export', { format: 'csv' })).status, 422)
  assert.equal((await owner.post('/api/reports/' + page.id + '/files', { format: 'pdf' })).status, 422)
  assert.equal((await raw(A.operator, ids.a, 'POST', '/api/reports/' + page.id + '/export', { format: 'pdf' })).status, 403, 'a file needs Use on Reports')
  assert.equal((await raw(B.owner, ids.b, 'POST', '/api/reports/' + page.id + '/export', { format: 'pdf' })).status, 404, 'another group\'s page')
})

test('Email it now with a PDF attached: the print page as a file in the message', async () => {
  assert.equal((await ok(owner.get('/api/reports/recipients'))).can_pdf, true)
  const sent = await recorded(() => sendNow({ message: 'For the meeting', delivery: { in_message: false, attach: 'pdf' } }))
  assert.equal(sent.out.status, 200, sent.out.body.slice(0, 300))
  assert.equal(sent.out.json.status, 'sent')
  assert.equal(mails.length, 1)
  const file = attachmentOf(mails[0])
  assert.ok(file, 'a file attached')
  assert.match(file.filename, /^sales-by-day-\d{4}-\d{2}-\d{2}\.pdf$/)
  assert.equal(file.type, 'application/pdf')
  const page = pageOf(Buffer.from(file.content, 'base64'))
  assert.ok(page.includes('<h1>Sales by day</h1>'))
  assert.ok(page.includes(CSP))
  assert.match(page, /Sent by a-owner@test\.local/)
  assert.match(htmlOf(mails[0]), /The report is attached as a PDF/)
  assert.equal(sent.made.length, 1)
  assert.deepEqual([sent.made[0].kind, sent.made[0].format, sent.made[0].error], ['emailed', 'pdf', null])

  // Outside the team: a copy of its own, whose top says only the period, venues and rows.
  mails.length = 0
  const out = await sendNow({ recipients: [{ email: 'accountant@outside.example' }] })
  assert.equal(out.status, 200, out.body.slice(0, 300))
  assert.equal(mails.length, 1)
  const theirs = pageOf(Buffer.from(attachmentOf(mails[0]).content, 'base64'))
  assert.ok(theirs.includes('<dt>Period</dt>'))
  assert.ok(theirs.includes('<dt>Rows</dt>'))

  // A browser that fails never stops the email: it goes with a note and no file.
  mails.length = 0
  useBrowser(failing)
  const noFile = await sendNow({})
  assert.equal(noFile.status, 200, noFile.body.slice(0, 300))
  assert.equal(noFile.json.status, 'sent')
  assert.equal(mails.length, 1)
  assert.equal(attachmentOf(mails[0]), null)
  assert.match(htmlOf(mails[0]), /The PDF couldn(&#39;|')t be made, so none is attached/)
  assert.equal(fs.existsSync(LOCK), false)

  // With no browser a PDF can't be asked for at all, on a send or on a schedule.
  mails.length = 0
  useBrowser(path.join(dir, 'nothing-here'))
  assert.equal((await ok(owner.get('/api/reports/recipients'))).can_pdf, false)
  const refused = await sendNow({})
  assert.equal(refused.status, 422)
  assert.match(refused.body, NO_BROWSER)
  assert.match(refused.body, /Attach a CSV or Excel file instead/)
  const schedule = await owner.post('/api/reports/' + DAY + '/schedules', {
    timing: { every: 'day', time: '07:00' }, delivery: { in_message: true, attach: 'pdf' }, recipients: [{ user_id: userId[A.owner] }],
  })
  assert.equal(schedule.status, 422)
  assert.match(schedule.body, NO_BROWSER)
  assert.equal(mails.length, 0)
})

test('a server with no browser says so before anything runs; a browser that fails is a plain refusal, recorded', async () => {
  const page = (await ok(owner.post('/api/reports', {
    name: 'Refused pack', spec: { kind: 'page', blocks: [{ type: 'report', ref: DAY }, { type: 'report', ref: SERVERS }] },
  }), 'page')).report

  // No browser.
  useBrowser(path.join(dir, 'nothing-here'))
  assert.equal(pdfAvailable(), false)
  assert.equal((await ok(owner.get('/api/reports'))).can_pdf, false)
  assert.equal((await ok(owner.get('/api/reports/' + DAY))).report.can_pdf, false)
  const had = await files()
  const none = await recorded(async () => [
    await exportPdf(DAY),
    await owner.post('/api/reports/' + DAY + '/files', { format: 'pdf', params: { period: today } }),
    await raw(A.owner, ids.a, 'POST', '/api/reports/' + page.id + '/export', { format: 'pdf' }),
  ])
  for (const res of none.out) {
    assert.equal(res.status, 422)
    assert.match(res.text ?? res.body, NO_BROWSER)
  }
  assert.equal(none.made.length, 0, 'nothing ran')
  assert.equal(await files(), had)
  await assert.rejects(htmlToPdf('<p>x</p>'), e => e.statusCode === 422)
  // The other files are still made.
  assert.equal((await raw(A.owner, ids.a, 'POST', '/api/reports/' + DAY + '/export', { format: 'csv', params: { period: today } })).status, 200)

  // A browser that stops, and one that writes something that isn't a PDF.
  for (const browser of [failing, notPdf]) {
    useBrowser(browser)
    assert.equal(pdfAvailable(), true)
    forgetReportResults()
    const one = await recorded(() => exportPdf(DAY))
    assert.equal(one.out.status, 503, browser)
    assert.match(one.out.text, /The PDF couldn(&#39;|')t be made\. Try again, or print the report/)
    assert.equal(one.made.length, 1)
    assert.deepEqual([one.made[0].kind, one.made[0].format], ['export', 'pdf'])
    assert.ok(one.made[0].error, 'recorded as failed')

    const kept = await recorded(() => owner.post('/api/reports/' + DAY + '/files', { format: 'pdf', params: { period: today } }))
    assert.equal(kept.out.status, 503)
    assert.equal(await files(), had, 'nothing kept')
    assert.ok(kept.made[0].error)

    const pack = await recorded(() => raw(A.owner, ids.a, 'POST', '/api/reports/' + page.id + '/export', { format: 'pdf' }))
    assert.equal(pack.out.status, 503)
    assert.equal(pack.made.length, 2)
    assert.ok(pack.made.every(r => r.format === 'pdf' && r.error), 'each report\'s file recorded as failed')
    assert.equal(fs.existsSync(LOCK), false, 'the machine\'s turn is handed back')
  }

  // Back with a browser: it works again at once.
  useBrowser(standIn)
  assert.equal((await exportPdf(DAY)).status, 200)
})

test('PDFs are made one at a time, in the order asked, and a page too big for one is refused', async () => {
  const out = await Promise.all([1, 2, 3].map(i => htmlToPdf('<p>page ' + i + '</p>')))
  out.forEach((buffer, i) => assert.equal(pageOf(buffer), '<p>page ' + (i + 1) + '</p>'))
  assert.equal(fs.existsSync(LOCK), false)
  await assert.rejects(htmlToPdf('x'.repeat(12 * 1024 * 1024 + 1)), e => e.statusCode === 422 && /too big for a PDF/.test(e.message))
  await assert.rejects(htmlToPdf(null), e => e.statusCode === 422)
  // Nothing of a PDF's making is left behind.
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(f => /^macaroonie-pdf-[A-Za-z0-9]{6}$/.test(f)), [])
})
