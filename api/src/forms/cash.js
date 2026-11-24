// src/forms/cash.js: the Cash Recon area's plain forms (src/forms/plain.js
// says what a definition holds), drawn from the route's own schema.

import { ExpenseBody } from '../routes/cashRecon.js'

export const forms = {
  expense: {
    schema: ExpenseBody,
    save: { method: 'POST', path: '/venues/:venue/cash-recon/expenses' },
    saved: '{description} {amount}',
    from: { date: 'date' },
    attach: { label: 'Receipt photo', path: '/venues/:venue/cash-recon/expenses/:id/receipt' },
    fields: {
      description:  { label: 'Description', help: 'What it was for.', examples: ['Milk', 'Window cleaner'] },
      amount:       { label: 'Amount (£)', kind: 'money', help: 'What was paid, VAT included.' },
      vat_amount:   { label: 'VAT (£)', kind: 'money', help: 'The VAT in the amount, from the receipt.' },
      category_id:  { label: 'Category', options: { path: '/venues/:venue/cash-recon/config', list: 'expense_categories', label: 'name', only: 'is_active' } },
      paid_by_card: { label: 'Paid by card', help: 'Card expenses don\'t come out of the till\'s cash.' },
      notes:        { label: 'Notes', kind: 'textarea' },
    },
    leave: {
      category: 'An old free-text category: the form picks one of the venue\'s categories',
    },
  },
}
