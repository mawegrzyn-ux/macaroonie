// shared/orderInfo.js: what a board tile or kitchen ticket shows about an order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { orderInfo, orderValue, orderText, normaliseOrderInfo, ORDER_FIELDS, MAIN_FIELDS } from '../orderInfo.js'

test('values and lines from a kitchen order or a board number', () => {
  const kitchen = { number: '57', tent: '14', table: null, tab: 'Jo', guest: null, type_name: 'Take out', source: 'till' }
  assert.equal(orderValue(kitchen, 'name'), 'Jo', 'a counter order: the name typed on the till')
  assert.equal(orderValue({ ...kitchen, table: '4', tab: null }, 'name'), '', 'a table order has no name')
  assert.equal(orderValue({ guest: 'Sam', source: 'online' }, 'name'), 'Sam')
  assert.equal(orderValue({ name: 'Ali' }, 'name'), 'Ali', 'a board number carries name')
  assert.equal(orderValue(kitchen, 'source'), '', 'till orders say nothing about where from')
  assert.equal(orderValue({ source: 'gloriafood' }, 'source'), 'GloriaFood')
  assert.equal(orderText(kitchen, 'tent'), 'Tent 14')
  assert.equal(orderText(kitchen, 'number'), 'Order 57')
  assert.equal(orderText(kitchen, 'table'), '')
  assert.deepEqual(MAIN_FIELDS.every(k => ORDER_FIELDS.some(f => f.key === k)), true)
})

test('the big value falls back to what the order has; lines skip it and blanks', () => {
  const o = { number: '57', tent: '14', name: 'Jo', type_name: 'Take out' }
  assert.deepEqual(orderInfo(o, { main: 'tent', lines: ['tent', 'number', 'name', 'table', 'type'] }), {
    key: 'tent', value: '14', caption: 'Tent',
    lines: [{ key: 'number', text: 'Order 57' }, { key: 'name', text: 'Jo' }, { key: 'type', text: 'Take out' }],
  })
  const noTent = orderInfo({ number: '58', name: 'Al' }, { main: 'tent', lines: ['name'] })
  assert.deepEqual([noTent.key, noTent.value, noTent.caption], ['number', '58', ''])
  const onlyName = orderInfo({ name: 'Al' }, { main: 'number' })
  assert.deepEqual([onlyName.key, onlyName.value], ['name', 'Al'], 'no number: the first field it has')
  assert.deepEqual(normaliseOrderInfo('type', ['source', 'source', 'x', 'number']), { main: 'number', lines: ['source'] },
    'order type is not a big value; repeats, unknown fields and the big one dropped')
})
