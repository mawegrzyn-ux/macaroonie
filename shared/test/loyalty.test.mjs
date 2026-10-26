// Loyalty rules (shared/loyalty.js, migration 211): settings cleaned, points
// and stamps for a sale, what a reward takes off a basket or a till check,
// member numbers and card codes.
// Run: node --test shared/test/

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normaliseProgramme, normaliseReward, normaliseStampCard, rewardProblems, stampCardProblems,
  pointsFor, stampsFor, stampProgress, rewardDiscount, tillDiscount, channelOn, spread,
  memberNo, validMemberNo, parseCardCode, cardCode, formatMemberNo, pointsText, rewardSummary, earnText,
  DEFAULT_TERMS, FEATURE_KEYS,
} from '../loyalty.js'

const uuid = () => globalThis.crypto.randomUUID()

test('a programme: defaults, bounds and unknown keys dropped', () => {
  const d = normaliseProgramme({})
  assert.equal(d.name, 'Loyalty')
  assert.equal(d.points.per_pound, 1)
  assert.equal(d.points.expiry_months, null)
  assert.deepEqual(Object.keys(d.features).sort(), [...FEATURE_KEYS].sort())
  assert.equal(d.features.points, true)
  assert.equal(d.features.stamps, false)
  assert.equal(d.features.network, false, 'the Macaroonie-wide programme starts off')
  assert.deepEqual(d.channels.kiosk, { earn: true, redeem: true })
  assert.equal(d.venue_ids, null, 'every venue')
  assert.equal(d.signup.terms_text, DEFAULT_TERMS)
  const v = uuid()
  const p = normaliseProgramme({
    name: '  Thai Club ', points: { per_pound: 5000, min_spend_pence: -3, welcome: 50, expiry_months: 0 },
    features: { stamps: true, points: false, junk: true }, channels: { online: { earn: false } },
    venue_ids: [v, 'nope', v], card: { background: '#ABCDEF', text: 'red' }, extra: 1,
  })
  assert.equal(p.name, 'Thai Club')
  assert.equal(p.points.per_pound, 1000)
  assert.equal(p.points.min_spend_pence, 0)
  assert.equal(p.points.welcome, 50)
  assert.equal(p.points.expiry_months, 1)
  assert.equal(p.features.stamps, true)
  assert.equal(p.features.points, false)
  assert.equal('junk' in p.features, false)
  assert.deepEqual(p.channels.online, { earn: false, redeem: true })
  assert.deepEqual(p.venue_ids, [v])
  assert.equal(p.card.background, '#abcdef')
  assert.equal(p.card.text, null)
  assert.equal('extra' in p, false)
})

test('channelOn: the programme, the channel and the venue all count', () => {
  const v1 = uuid(), v2 = uuid()
  const prog = { enabled: true, settings: normaliseProgramme({ channels: { kiosk: { redeem: false } }, venue_ids: [v1] }) }
  assert.equal(channelOn(prog, 'till', 'earn', v1), true)
  assert.equal(channelOn(prog, 'kiosk', 'redeem', v1), false)
  assert.equal(channelOn(prog, 'till', 'earn', v2), false, 'a venue not taking part')
  assert.equal(channelOn({ ...prog, enabled: false }, 'till', 'earn', v1), false)
  assert.equal(channelOn(prog, 'phone', 'earn', v1), false)
})

test('rewards and stamp cards: cleaned, and their problems in words', () => {
  const r = normaliseReward({ kind: 'percent_off', value: 250, channels: ['kiosk', 'x'], points_cost: '300' })
  assert.equal(r.value, 100)
  assert.deepEqual(r.channels, ['kiosk'])
  assert.equal(r.points_cost, 300)
  const free = normaliseReward({ kind: 'free_item', item_ids: [] })
  assert.equal(free.value, null, 'a free dish is its price unless capped')
  assert.match(rewardProblems(free)[0], /Pick the dishes/)
  assert.deepEqual(rewardProblems(normaliseReward({ kind: 'amount_off', value: 300 })), [])
  assert.equal(normaliseReward({ kind: 'bogus' }).kind, 'amount_off')
  const c = normaliseStampCard({ stamps_needed: 1, earn: { per: 'item' } })
  assert.equal(c.stamps_needed, 2)
  assert.equal(stampCardProblems(c).length, 2)
  const visit = normaliseStampCard({ stamps_needed: 99, reward_id: uuid(), earn: { per: 'visit', item_ids: [uuid()] } })
  assert.equal(visit.stamps_needed, 50)
  assert.deepEqual(visit.earn.item_ids, [], 'a visit card earns on no dishes')
  assert.deepEqual(stampCardProblems(visit), [])
})

test('points for a spend: per pound, rounded down, a minimum spend', () => {
  const s = normaliseProgramme({ points: { per_pound: 10, min_spend_pence: 500 } })
  assert.equal(pointsFor(1299, s), 129)
  assert.equal(pointsFor(499, s), 0)
  assert.equal(pointsFor(-50, s), 0)
  assert.equal(pointsFor(1000, normaliseProgramme({})), 10)
})

test('stamps for a sale: per dish with meal parts, per visit, the cap', () => {
  const latte = uuid(), cake = uuid(), drinks = uuid()
  const card = normaliseStampCard({ stamps_needed: 8, reward_id: uuid(), earn: { per: 'item', item_ids: [latte], section_ids: [drinks] } })
  const sale = { spend_pence: 1500, lines: [
    { item_id: latte, qty: 2 },
    { item_id: cake, section_id: drinks, qty: 1 },
    { item_id: uuid(), qty: 3, parts: [{ item_id: latte }, { item_id: uuid() }] },
    { item_id: uuid(), qty: 5 },
  ] }
  assert.equal(stampsFor(card, sale), 2 + 1 + 3)
  assert.equal(stampsFor({ ...card, earn: { ...card.earn, max_per_sale: 4 } }, sale), 4)
  assert.equal(stampsFor({ ...card, is_active: false }, sale), 0)
  const visit = normaliseStampCard({ stamps_needed: 5, reward_id: uuid(), earn: { per: 'visit', min_spend_pence: 1000 } })
  assert.equal(stampsFor(visit, sale), 1)
  assert.equal(stampsFor(visit, { spend_pence: 900, lines: sale.lines }), 0)
  assert.deepEqual(stampProgress(card, 11), { count: 3, needed: 8, left: 5 })
})

test('spread: whole pence, never more than a line has', () => {
  assert.deepEqual(spread(100, [300, 100]), [75, 25])
  assert.deepEqual(spread(101, [100, 100, 100]).reduce((s, x) => s + x, 0), 101)
  assert.deepEqual(spread(50, [0, 0]), [0, 0])
  const out = spread(299, [100, 199])
  assert.deepEqual(out, [100, 199])
})

test('rewardDiscount: money off, percent off, a free dish, minimum spend', () => {
  const latte = uuid()
  const lines = [
    { item_id: latte, qty: 2, left_pence: 700 },
    { item_id: uuid(), qty: 1, left_pence: 1300 },
  ]
  const five = normaliseReward({ kind: 'amount_off', value: 500 })
  const r1 = rewardDiscount(five, lines)
  assert.equal(r1.discount_pence, 500)
  assert.equal(r1.lines.reduce((s, x) => s + x, 0), 500)
  assert.equal(rewardDiscount({ ...five, value: 5000 }, lines).discount_pence, 2000, 'never more than the basket')
  assert.equal(rewardDiscount(normaliseReward({ kind: 'percent_off', value: 10 }), lines).discount_pence, 200)
  const free = normaliseReward({ kind: 'free_item', item_ids: [latte] })
  const r3 = rewardDiscount(free, lines)
  assert.deepEqual(r3.lines, [350, 0], 'one latte free')
  const capped = rewardDiscount({ ...free, value: 300 }, lines)
  assert.equal(capped.discount_pence, 300)
  assert.match(rewardDiscount(free, [lines[1]]).error, /Add one of the dishes/)
  const min = normaliseReward({ kind: 'amount_off', value: 300, min_spend_pence: 2500 })
  assert.match(rewardDiscount(min, lines).error, /Spend £25.00/)
  assert.equal(rewardDiscount(five, [{ item_id: latte, qty: 1, left_pence: 0 }]).ok, false)
})

test('tillDiscount: the discount event a reward makes on a check', () => {
  const latte = uuid()
  const check = { lines: [{ id: 'L1', item_id: latte, qty: 2, unit_price: 350, modifiers: [] }, { id: 'L2', item_id: uuid(), qty: 1 }] }
  const totals = { net: 2000, lines: [{ id: 'L1', net: 700 }, { id: 'L2', net: 1300 }] }
  assert.deepEqual(tillDiscount(normaliseReward({ name: '£5 off', kind: 'amount_off', value: 500 }), check, totals).discount,
    { scope: 'check', line_ids: [], type: 'amount', value: 500, name: '£5 off' })
  assert.equal(tillDiscount(normaliseReward({ kind: 'amount_off', value: 9000 }), check, totals).discount.value, 2000)
  assert.equal(tillDiscount(normaliseReward({ kind: 'percent_off', value: 15 }), check, totals).discount.type, 'percent')
  const free = tillDiscount(normaliseReward({ name: 'Free latte', kind: 'free_item', item_ids: [latte] }), check, totals)
  assert.deepEqual(free.discount, { scope: 'line', line_ids: ['L1'], type: 'amount', value: 350, name: 'Free latte' })
  assert.equal(tillDiscount(normaliseReward({ kind: 'amount_off', value: 100 }), check, { net: 0, lines: [] }).ok, false)
})

test('member numbers carry a check digit; card codes are read from QR codes, links or typing', () => {
  const no = memberNo(1234)
  assert.equal(no.length, 9)
  assert.equal(validMemberNo(no), true)
  assert.equal(validMemberNo(no.slice(0, 8) + ((Number(no[8]) + 1) % 10)), false, 'a typo is caught')
  assert.equal(formatMemberNo('000012343'), '000 012 343')
  const token = 'aB3dE5fG7hJ9kL1mN3pQ5r'
  assert.deepEqual(parseCardCode(cardCode(token)), { token })
  assert.deepEqual(parseCardCode('https://thai.macaroonie.com/loyalty/c/' + token), { token })
  assert.deepEqual(parseCardCode(' ' + no.slice(0, 3) + ' ' + no.slice(3, 6) + '-' + no.slice(6) + ' '), { member_no: no })
  assert.equal(parseCardCode('ML1.short'), null)
  assert.equal(parseCardCode('hello'), null)
  assert.equal(parseCardCode(''), null)
})

test('words: points and reward summaries', () => {
  const s = normaliseProgramme({ points: { label: 'beans' } })
  assert.equal(pointsText(1250, s), '1,250 beans')
  assert.equal(pointsText(1, s), '1 bean')
  assert.equal(rewardSummary({ kind: 'amount_off', value: 500 }), '£5 off')
  assert.equal(rewardSummary({ kind: 'amount_off', value: 250 }), '£2.50 off')
  assert.equal(rewardSummary({ kind: 'percent_off', value: 20 }), '20% off')
  const id = uuid()
  assert.equal(rewardSummary({ kind: 'free_item', item_ids: [id], section_ids: [] }, { [id]: 'Latte' }), 'A free Latte')
})

test('earnText: how points are earned, one point or many', () => {
  assert.equal(earnText(normaliseProgramme({})), 'Earn 1 point for every £1 you spend.')
  assert.equal(earnText(normaliseProgramme({ points: { label: 'beans', per_pound: 10, welcome: 1 } })), 'Earn 10 beans for every £1 you spend, and 1 bean when you join.')
  assert.equal(earnText(normaliseProgramme({ points: { per_pound: 2, welcome: 1500 } })), 'Earn 2 points for every £1 you spend, and 1,500 points when you join.')
  assert.equal(earnText(null), '')
})
