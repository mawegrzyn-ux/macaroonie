// Loyalty (migration 211): the programme on, rewards (one a free dish, made.dish
// from menus.mjs), a stamp card, a member with points. fillTenant(..., { loyalty:
// false }) leaves it out: loyalty.test.mjs starts without it.
export const order = 200

export async function fill(ctx) {
  const { mark, ids, made, withLoyalty, step, post, put, patch, get } = ctx
  const { dish } = made
  const loyalty = withLoyalty ? await step('loyalty programme', () => get('/api/loyalty/programme')) : null
  if (loyalty) {
    const lp = loyalty.programme.settings
    await step('loyalty on', () => put('/api/loyalty/programme', { enabled: true, settings: { ...lp, name: mark + ' Club', features: { ...lp.features, stamps: true } } }))
  }
  const fiver = loyalty && await step('loyalty reward', () => post('/api/loyalty/rewards', { name: mark + ' £5 off', kind: 'amount_off', value: 500, points_cost: 100 }))
  const freeDish = loyalty && dish ? await step('loyalty free dish', () => post('/api/loyalty/rewards', { name: mark + ' Free dish', kind: 'free_item', item_ids: [dish.id], points_cost: 50 })) : null
  if (freeDish) await step('loyalty stamp card', () => post('/api/loyalty/stamp-cards', { name: mark + ' Card', stamps_needed: 5, earn: { per: 'item', item_ids: [dish.id] }, reward_id: freeDish.id }))
  const member = loyalty && await step('loyalty member', () => post('/api/loyalty/members', { name: mark + ' Member', email: (mark + '.member@example.test').toLowerCase(), agreed: true }))
  if (member) {
    ids.loyaltyMember = member.id
    await step('loyalty points', () => post(`/api/loyalty/members/${member.id}/adjust`, { points: 300, note: mark + ' opening' }))
    if (fiver) await step('loyalty give reward', () => post(`/api/loyalty/members/${member.id}/rewards`, { reward_id: fiver.id, note: mark + ' sorry' }))
    await step('loyalty member note', () => patch(`/api/loyalty/members/${member.id}`, { notes: mark + ' regular' }))
  }
}
