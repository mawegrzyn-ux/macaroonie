// shared/registry/purchasing.js: the Purchasing area's business objects
// (shared/registry/index.js says what a record holds).

export const objects = [
  {
    key: 'purchasing.suppliers', label: 'Supplier', plural: 'Suppliers', words: ['vendor', 'wholesaler'],
    table: 'suppliers', subjects: ['purchasing.suppliers'],
    page: '/suppliers',
    actions: ['add_supplier', 'update_supplier'],
    forms: ['supplier'],
  },
  {
    key: 'purchasing.items', label: 'Inventory item', plural: 'Inventory items', words: ['stock item', 'ingredient'],
    table: 'inv_items', subjects: ['purchasing.items', 'purchasing.categories'],
    page: '/inventory',
    actions: ['add_inventory_item', 'update_inventory_item', 'switch_items'],
  },
  {
    key: 'purchasing.prices', label: 'Supplier price', plural: 'Supplier prices', words: ['price list', 'product code', 'out of stock'],
    table: 'inv_quotes', subjects: ['purchasing.prices', 'purchasing.price_changes'],
    page: '/suppliers',
    actions: ['add_supplier_price', 'update_supplier_price', 'set_preferred_supplier', 'import_price_list', 'update_prices_by_code', 'set_out_of_stock'],
  },
  {
    key: 'purchasing.stock', label: 'Stock on hand', plural: 'Stock on hand', words: ['stock count', 'stocktake', 'stock level', 'in stock'],
    table: 'stock_counts', subjects: ['purchasing.stock'],
    page: '/inventory',
    actions: ['count_stock'],
  },
  {
    key: 'purchasing.order_lists', label: 'Order list', plural: 'Order lists', words: ['pars', 'par levels'],
    table: 'order_lists',
    page: '/purchasing/lists',
    actions: ['create_order_list', 'update_order_list', 'set_pars'],
  },
  {
    key: 'purchasing.restaurant_orders', label: 'Restaurant order', plural: 'Restaurant orders', words: ['order form', 'stock order', 'order request'],
    table: 'supply_orders', subjects: ['purchasing.restaurant_orders'],
    page: '/purchasing',
    actions: ['order_form', 'update_order', 'import_supplier_basket', 'place_order', 'request_order', 'send_back_order', 'split_order'],
    forms: ['order'],
  },
  {
    key: 'purchasing.orders', label: 'Supplier order', plural: 'Supplier orders', words: ['purchase order', 'po', 'delivery'],
    table: 'purchase_orders', subjects: ['purchasing.orders', 'purchasing.order_lines'],
    page: '/purchasing',
    actions: ['send_purchase_order', 'change_purchase_order', 'cancel_purchase_order', 'receive_delivery'],
  },
  {
    key: 'purchasing.invoices', label: 'Supplier invoice', plural: 'Supplier invoices', words: ['invoice'],
    table: 'purchase_invoices', subjects: ['purchasing.invoices'],
    page: '/purchasing',
  },
]
