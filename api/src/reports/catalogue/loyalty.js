// src/reports/catalogue/loyalty.js
//
// Loyalty in the report catalogue: members, every change to their points and
// stamps (the ledger), the rewards they used, the rewards they were given,
// and the group's rewards and stamp cards.
//
// The rules are the loyalty service's (services/loyaltySvc.js): points and
// stamps change only through the ledger, so a member's points are the sum
// of their ledger rows; a sale's points can be worked out again (a refund, a
// member put on later), which adds a row for the difference, so a sale may
// have several earn rows and their points add up to what it gave. Spending a
// reward takes its points off (redeem); one put back gives them back
// (release). An erased member keeps their rows with nothing personal left.

import { subject, text, number, money, yesno, choice, moment, sum, avg, count, one, many } from './define.js'

const MEMBERS = 'loyalty_members'
const ACTIVE = "{t}.status = 'active'"
const CHANNELS = { till: 'Till', kiosk: 'Kiosk', online: 'Online ordering', web: 'Web app', staff: 'Staff' }
const KINDS = {
  earn: 'Earned', redeem: 'Spent on a reward', release: 'Given back', adjust: 'Changed by staff',
  welcome: 'Welcome points', expire: 'Expired', stamps: 'Stamps', card_full: 'Card filled',
}
const SOURCES = {
  check: 'A till check', order: 'An online order', redemption: 'A reward', staff: 'Staff',
  join: 'Joining', expiry: 'Expiry', stamp_card: 'A full stamp card',
}
const REWARD_KINDS = { amount_off: 'Money off', percent_off: 'Percent off', free_item: 'A free dish' }
const DAYS_SINCE_VISIT = '((now() AT TIME ZONE {tz})::date - ({t}.last_visit_at AT TIME ZONE {tz})::date)'

export default [
  subject({
    key: 'loyalty.members',
    label: 'Loyalty members',
    one: 'member',
    area: 'loyalty',
    module: MEMBERS,
    about: 'Everyone who joined the loyalty programme, with their points, visits and spend. An erased member keeps their row with nothing personal left.',
    from: 'loyalty_members',
    name: 'member_no',
    date: { sql: '({t}.joined_at AT TIME ZONE {tz})::date', bound: '{t}.joined_at', label: 'Day joined' },
    open: { page: '/loyalty?tab=members&member=:id', module: MEMBERS, label: 'Open the member' },
    fields: {
      member_no: text('member_no', { label: 'Member number' }),
      name: text('name', { pii: true }),
      email: text('email', { pii: true }),
      phone: text('phone', { pii: true }),
      notes: text('notes', { pii: true }),
      status: choice('status', { active: 'Active', closed: 'Closed', erased: 'Erased' }),
      points: number('points', { label: 'Points now', adds: true, decimals: 0 }),
      points_earned: number('points_earned', { label: 'Points earned', adds: true, decimals: 0 }),
      points_spent: number('points_spent', { label: 'Points spent', adds: true, decimals: 0 }),
      joined_at: moment('joined_at', { label: 'Joined at' }),
      joined_through: choice('joined_channel', CHANNELS, { label: 'Joined through' }),
      last_activity_at: moment('last_activity_at', { label: 'Last activity' }),
      last_visit_at: moment('last_visit_at', { label: 'Last visit' }),
      days_since_visit: number({ sql: DAYS_SINCE_VISIT }, { label: 'Days since last visit', decimals: 0 }),
      visits: number('visits', { adds: true, decimals: 0 }),
      spend: money('spend_pence', { label: 'Spend', adds: true }),
      newsletter: yesno('marketing_opt_in', { label: 'Gets the newsletter' }),
      newsletter_since: moment('marketing_opt_in_at', { label: 'Joined the newsletter' }),
      tags: text({ sql: "array_to_string({t}.tags, ', ')" }, { label: 'Tags' }),
      in_wallet: yesno({ sql: '({t}.apple_saved_at IS NOT NULL OR {t}.google_saved_at IS NOT NULL)' }, { label: 'Card in a phone wallet' }),
      erased_at: moment('erased_at', { label: 'Erased at' }),
    },
    measures: {
      members: count({ label: 'Members', where: ACTIVE, about: 'Memberships that are active (not closed or erased).' }),
      joined: count({ label: 'Joined', about: 'Everyone who joined, also memberships closed or erased since.' }),
      points_balance: sum('points', { label: 'Points held', where: ACTIVE, about: 'The points active members hold now.' }),
      average_points: avg('points', { label: 'Average points', where: ACTIVE }),
      on_newsletter: count({ label: 'On the newsletter', where: ACTIVE + ' AND {t}.marketing_opt_in' }),
      in_wallets: count({ label: 'Cards in phone wallets', where: ACTIVE + ' AND ({t}.apple_saved_at IS NOT NULL OR {t}.google_saved_at IS NOT NULL)' }),
    },
    links: {
      joined_venue: one('venue', 'joined_venue_id', { label: 'Venue joined at' }),
      customer: one('guests.customers', 'customer_id', { label: 'Customer record', needs: 'customers' }),
      ledger: many('loyalty.ledger', 'member_id', { label: 'Points and stamps' }),
      redemptions: many('loyalty.redemptions', 'member_id', { label: 'Rewards used' }),
      rewards_given: many('loyalty.member_rewards', 'member_id', { label: 'Rewards given' }),
    },
    list: ['member_no', 'name', 'status', 'points', 'visits', 'spend', 'last_visit_at', 'joined_at'],
    sort: [{ by: 'joined_at', dir: 'desc' }],
    // The programme, the shared identity across groups, the card's secret,
    // the email's hash for look-ups, the wallet's key and push times, what
    // was agreed when joining, and when the row was made and changed.
    skip: ['programme_id', 'identity_id', 'card_token', 'email_hash', 'wallet_token', 'wallet_updated_at',
      'wallet_pushed_at', 'consent', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'loyalty.ledger',
    label: 'Points and stamps',
    one: 'change',
    area: 'loyalty',
    module: MEMBERS,
    about: 'Every change to a member\'s points and stamps: earned on a sale, welcome points, spent on a reward, given back, changed by staff, expired, stamps and full cards.',
    from: 'loyalty_ledger',
    venue: 'venue_id',
    date: { sql: '({t}.created_at AT TIME ZONE {tz})::date', bound: '{t}.created_at', label: 'Day' },
    open: 'member',
    fields: {
      at: moment('created_at', { label: 'When' }),
      kind: choice('kind', KINDS, { label: 'What happened' }),
      points: number('points', { adds: true, decimals: 0 }),
      stamps: number('stamps', { adds: true, decimals: 0 }),
      source: choice('source_kind', SOURCES, { label: 'From' }),
      channel: choice('channel', CHANNELS, { label: 'Where' }),
      spend: money('spend_pence', { label: 'Spend it came from', adds: false, about: 'What the sale counted for when its points were worked out (repeated on each row for the same sale).' }),
      note: text('note', { pii: true }),
      by: text('created_by', { label: 'Changed by' }),
    },
    measures: {
      earned: sum('points', { label: 'Points earned', where: "{t}.kind = 'earn'", about: 'Points members earned on sales, after refunds.' }),
      welcome: sum('points', { label: 'Welcome points', where: "{t}.kind = 'welcome'" }),
      adjusted: sum('points', { label: 'Points changed by staff', where: "{t}.kind = 'adjust'" }),
      spent: sum({ sql: '-{t}.points' }, { label: 'Points spent', where: "{t}.kind IN ('redeem', 'release')", about: 'Points spent on rewards, less points given back for rewards put back.' }),
      expired: sum({ sql: '-{t}.points' }, { label: 'Points expired', where: "{t}.kind = 'expire'" }),
      net: sum('points', { label: 'Change in points', about: 'Every change added up: what members hold more (or less) at the end than at the start.' }),
      stamps_given: sum('stamps', { label: 'Stamps given', where: "{t}.kind = 'stamps'" }),
      cards_filled: count({ label: 'Cards filled', where: "{t}.kind = 'card_full'" }),
      changes: count({ label: 'Changes' }),
    },
    links: {
      member: one('loyalty.members', 'member_id', { label: 'Member' }),
      stamp_card: one('loyalty.stamp_cards', 'stamp_card_id', { label: 'Stamp card' }),
      check: one('till.checks', { sql: "(CASE WHEN {t}.source_kind = 'check' THEN {t}.source_id END)" }, { label: 'Check' }),
      order: one('online.orders', { sql: "(CASE WHEN {t}.source_kind = 'order' THEN {t}.source_id::uuid END)" }, { label: 'Online order', needs: 'web_orders' }),
      redemption: one('loyalty.redemptions', { sql: "(CASE WHEN {t}.source_kind = 'redemption' THEN {t}.source_id::uuid END)" }, { label: 'Reward used' }),
    },
    list: ['date', 'at', 'member.member_no', 'kind', 'points', 'stamps', 'source', 'venue.name'],
    sort: [{ by: 'at', dir: 'desc' }],
  }),

  subject({
    key: 'loyalty.redemptions',
    label: 'Rewards used',
    one: 'reward used',
    area: 'loyalty',
    module: MEMBERS,
    about: 'Every reward a member took on a till, kiosk or online order: held while the order is made, then used or given back.',
    from: 'loyalty_redemptions',
    name: 'name',
    venue: 'venue_id',
    date: { sql: '({t}.reserved_at AT TIME ZONE {tz})::date', bound: '{t}.reserved_at', label: 'Day' },
    open: 'member',
    fields: {
      name: text('name', { label: 'Reward' }),
      status: choice('status', { reserved: 'Held', used: 'Used', released: 'Given back' }),
      channel: choice('channel', CHANNELS, { label: 'Where' }),
      points: number('points', { label: 'Points', adds: true, decimals: 0 }),
      discount: money('discount_pence', { label: 'Discount', adds: true }),
      held_at: moment('reserved_at', { label: 'Held at' }),
      used_at: moment('used_at', { label: 'Used at' }),
      given_back_at: moment('released_at', { label: 'Given back at' }),
      why_given_back: text('release_reason', { label: 'Why it was given back' }),
      held_until: moment('expires_at', { label: 'Held until' }),
    },
    measures: {
      used: count({ label: 'Rewards used', where: "{t}.status = 'used'" }),
      points_spent: sum('points', { label: 'Points spent', where: "{t}.status = 'used'" }),
      discount_given: sum('discount_pence', { type: 'money', label: 'Discount given', where: "{t}.status = 'used'", about: 'What the rewards used took off orders.' }),
      given_back: count({ label: 'Given back', where: "{t}.status = 'released'", about: 'Rewards taken off an order or never used, their points given back.' }),
    },
    links: {
      member: one('loyalty.members', 'member_id', { label: 'Member' }),
      reward: one('loyalty.rewards', 'reward_id', { label: 'Reward' }),
      reward_given: one('loyalty.member_rewards', 'member_reward_id', { label: 'Reward given' }),
      check: one('till.checks', 'check_id', { label: 'Check' }),
      order: one('online.orders', 'order_id', { label: 'Online order', needs: 'web_orders' }),
      staff: one('till.takers', 'staff_id', { label: 'Taken by' }),
    },
    list: ['date', 'used_at', 'member.member_no', 'name', 'status', 'channel', 'points', 'discount'],
    sort: [{ by: 'held_at', dir: 'desc' }],
    // The discount as the till applies it, the till event that used it, the
    // device that asked for it, and when the row last changed.
    skip: ['discount', 'used_event_id', 'device_id', 'updated_at'],
  }),

  subject({
    key: 'loyalty.member_rewards',
    label: 'Rewards given',
    one: 'reward given',
    area: 'loyalty',
    module: MEMBERS,
    about: 'Rewards members were given (a full stamp card, or staff) and whether they used them.',
    from: 'loyalty_member_rewards',
    date: { sql: '({t}.issued_at AT TIME ZONE {tz})::date', bound: '{t}.issued_at', label: 'Day given' },
    open: 'member',
    fields: {
      source: choice('source', { stamp_card: 'A full stamp card', staff: 'Given by staff' }, { label: 'Given for' }),
      status: choice('status', { available: 'Not used yet', reserved: 'Held', used: 'Used', expired: 'Expired', cancelled: 'Taken back' }),
      given_at: moment('issued_at', { label: 'Given at' }),
      used_at: moment('used_at', { label: 'Used at' }),
      ends_at: moment('expires_at', { label: 'Ends at' }),
      note: text('note', { pii: true }),
      given_by: text('created_by', { label: 'Given by' }),
    },
    measures: {
      given: count({ label: 'Rewards given' }),
      used: count({ label: 'Used', where: "{t}.status = 'used'" }),
      not_used: count({ label: 'Not used yet', where: "{t}.status = 'available'" }),
      expired: count({ label: 'Expired', where: "{t}.status = 'expired'" }),
    },
    links: {
      member: one('loyalty.members', 'member_id', { label: 'Member' }),
      reward: one('loyalty.rewards', 'reward_id', { label: 'Reward' }),
      stamp_card: one('loyalty.stamp_cards', { sql: "(CASE WHEN {t}.source = 'stamp_card' THEN split_part({t}.source_id, ':', 1)::uuid END)" }, { label: 'Stamp card' }),
    },
    list: ['date', 'member.member_no', 'reward.name', 'source', 'status', 'used_at'],
    sort: [{ by: 'given_at', dir: 'desc' }],
    skip: ['updated_at'],
  }),

  subject({
    key: 'loyalty.rewards',
    label: 'Loyalty rewards',
    one: 'reward',
    area: 'loyalty',
    module: 'loyalty',
    about: 'The rewards of the loyalty programme: for points, from stamp cards or given by staff.',
    from: 'loyalty_rewards',
    name: 'name',
    fields: {
      name: text({ sql: "({t}.data->>'name')" }),
      kind: choice({ sql: "({t}.data->>'kind')" }, REWARD_KINDS, { label: 'Kind of reward' }),
      points_cost: number('points_cost', { label: 'Points it costs', decimals: 0 }),
      active: yesno('is_active', { label: 'On offer' }),
    },
    measures: { rewards: count({ label: 'Rewards', where: '{t}.is_active' }) },
    links: {
      used: many('loyalty.redemptions', 'reward_id', { label: 'Times used' }),
      given: many('loyalty.member_rewards', 'reward_id', { label: 'Times given' }),
      stamp_cards: many('loyalty.stamp_cards', 'reward_id', { label: 'Stamp cards' }),
    },
    list: ['name', 'kind', 'points_cost', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['programme_id', 'sort_order', 'created_at', 'updated_at'],
  }),

  subject({
    key: 'loyalty.stamp_cards',
    label: 'Stamp cards',
    one: 'stamp card',
    area: 'loyalty',
    module: 'loyalty',
    about: 'The programme\'s stamp cards: how many stamps fill one, what earns a stamp and the reward a full card gives.',
    from: 'loyalty_stamp_cards',
    name: 'name',
    fields: {
      name: text({ sql: "({t}.data->>'name')" }),
      stamps_needed: number({ sql: "(({t}.data->>'stamps_needed')::int)" }, { label: 'Stamps to fill it', decimals: 0 }),
      earned_for: choice({ sql: "COALESCE({t}.data->'earn'->>'per', 'item')" }, { item: 'Each dish', visit: 'Each visit' }, { label: 'A stamp for' }),
      active: yesno('is_active', { label: 'In use' }),
    },
    measures: { cards: count({ label: 'Stamp cards', where: '{t}.is_active' }) },
    links: {
      reward: one('loyalty.rewards', 'reward_id', { label: 'Reward' }),
      stamps: many('loyalty.ledger', 'stamp_card_id', { label: 'Stamps and full cards' }),
    },
    list: ['name', 'stamps_needed', 'earned_for', 'reward.name', 'active'],
    sort: [{ by: 'name', dir: 'asc' }],
    skip: ['programme_id', 'sort_order', 'created_at', 'updated_at'],
  }),
]
