// src/forms/purchasing.js: the Purchasing area's plain forms (src/forms/plain.js
// says what a definition holds), drawn from the route's own schema.

import { SupplierBody } from '../routes/suppliers.js'

export const forms = {
  supplier: {
    schema: SupplierBody,
    save: { method: 'POST', path: '/suppliers' },
    saved: 'Added the supplier {name}',
    fields: {
      name:         { label: 'Name', help: 'As it is on their invoices.', examples: ['Fresh Co', 'Brakes'] },
      contact_name: { label: 'Contact', help: 'Who to ask for.' },
      phone:        { label: 'Phone', kind: 'tel' },
      email:        { label: 'Email', kind: 'email', help: 'Where emailed orders go.', examples: ['orders@freshco.co.uk'] },
      send_method:  {
        label: 'Orders go by', help: 'How a placed order reaches them.',
        choices: { email: 'Email', print: 'Printed (phone or hand it over)', excel: 'Excel file', pdf: 'PDF file' },
      },
      account_ref:  { label: 'Account number', help: 'Your account with them, printed on orders.' },
      cutoff_time:  { label: 'Order by', help: 'The latest time an order reaches them for the next delivery.', examples: ['14:00'] },
      lead_days:    { label: 'Days\' notice', help: 'Days between ordering and delivery (0 = the same day).' },
      min_order:    { label: 'Minimum order (£)', kind: 'money' },
      delivery_charge: { label: 'Delivery charge (£)', kind: 'money' },
      website:      { label: 'Website', kind: 'url' },
      notes:        { label: 'Notes', kind: 'textarea' },
    },
    leave: {
      cc_emails: 'Copies of order emails: set on the supplier\'s page',
      email_attachment: 'What an order email carries: set on the supplier\'s page',
      delivery_days: 'The days they deliver (a list of weekdays): set on the supplier\'s page',
      is_active: 'A new supplier is switched on',
      ref_required: 'Whether sending needs their order reference: set on the supplier\'s page',
    },
  },
}
