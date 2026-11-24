// shared/registry/loyalty.js: the Loyalty area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'loyalty.members', label: 'Loyalty member', plural: 'Loyalty members', words: ['member', 'points', 'stamps'],
    table: 'loyalty_members', subjects: ['loyalty.members', 'loyalty.ledger', 'loyalty.redemptions', 'loyalty.member_rewards'],
    page: '/loyalty',
  },
  {
    key: 'loyalty.rewards', label: 'Loyalty reward', plural: 'Loyalty rewards', words: ['reward', 'stamp card'],
    table: 'loyalty_rewards', subjects: ['loyalty.rewards', 'loyalty.stamp_cards'],
    page: '/loyalty',
  },
]
