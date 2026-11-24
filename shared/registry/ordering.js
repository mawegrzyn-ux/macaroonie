// shared/registry/ordering.js: the Online ordering area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'online.orders', label: 'Online order', plural: 'Online orders', words: ['order', 'collection order', 'web order', 'refund'],
    table: 'orders', subjects: ['online.orders', 'online.items', 'online.order_events', 'online.sales'],
    page: '/orders', open: { page: '/orders', with: ['venue', 'date', 'tab'] },
    actions: ['update_online_order', 'refund_online_order', 'pause_online_orders'],
  },
  {
    key: 'online.sold_out', label: 'Sold out dish', plural: 'Sold out dishes', words: ['sold out', '86', 'out of stock dish'],
    table: 'ordering_item_availability', subjects: ['online.sold_out'],
    page: '/orders',
    actions: ['set_sold_out'],
    forms: ['sold_out'],
  },
  {
    key: 'online.promotion_list', label: 'Promotion', plural: 'Promotions', words: ['offer', 'discount code', 'promo', 'deal'],
    table: 'promotions', subjects: ['online.promotion_list', 'online.promotions'],
    page: '/promotions',
    actions: ['switch_promotion'],
  },
]
