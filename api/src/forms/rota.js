// src/forms/rota.js: the Staff & rota area's plain forms (src/forms/plain.js
// says what a definition holds), drawn from the route's own schema.

import { StaffBody } from '../routes/rota.js'

export const forms = {
  staff_member: {
    schema: StaffBody,
    save: { method: 'POST', path: '/rota/venues/:venue/staff' },
    saved: 'Added {name} to the staff',
    fields: {
      name:         { label: 'Name', help: 'As it shows on the rota and the wages.', examples: ['Jo Bloggs'] },
      role_id:      { label: 'Role', help: 'Sets their tip points. Roles are added on the Roles page.', options: { path: '/rota/setup', list: 'roles', label: 'name', only: 'is_active' } },
      pay_type:     { label: 'Pay type', choices: { hourly: 'Hourly', fixed: 'Fixed' } },
      pay_basis:    { label: 'Fixed pay is', choices: { week: 'A week', day: 'A day', shift: 'A shift' }, when: { pay_type: 'fixed' } },
      default_rate: { label: 'Rate (£)', kind: 'money', help: 'An hour for hourly pay; a week, day or shift for fixed pay.' },
      pay_method:   { label: 'Paid by', choices: { cash: 'Cash', bank: 'Bank transfer', split: 'Some by bank, the rest cash' } },
      bank_amount:  { label: 'Bank transfer each week (£)', kind: 'money', when: { pay_method: 'split' } },
    },
    leave: {
      is_active: 'Someone added is on the rota',
      shift_rates: 'Rates per shift (a list): set on the staff member\'s page after adding',
    },
  },
}
