// src/areas/bookings.js
//
// The bookings area's route plugins (docs/claude/areas/bookings.md). app.js
// registers every area file's routes, each as app.register(plugin, options),
// after the infrastructure (docs/PARALLEL_WORK.md 3.5). Fastify routes don't
// depend on their order, so the files need none.

import venuesRoutes from '../routes/venues.js'
import schedulesRoutes from '../routes/schedules.js'
import slotsRoutes from '../routes/slots.js'
import bookingsRoutes from '../routes/bookings.js'
import customersRoutes from '../routes/customers.js'
import paymentsRoutes from '../routes/payments.js'
import emailTemplateRoutes from '../routes/emailTemplates.js'
import emailMonitoringRoutes from '../routes/emailMonitoring.js'
import widgetApiRoutes from '../routes/widgetApi.js'
import testDataRoutes from '../routes/testData.js'
import manageBookingRoutes from '../routes/manageBooking.js'

export const routes = [
  [venuesRoutes, { prefix: '/api/venues' }],
  [schedulesRoutes, { prefix: '/api/venues' }],
  [slotsRoutes, { prefix: '/api/venues' }],
  [bookingsRoutes, { prefix: '/api/bookings' }],
  [customersRoutes, { prefix: '/api/customers' }],
  [paymentsRoutes, { prefix: '/api/payments' }],
  [emailTemplateRoutes, { prefix: '/api/email-templates' }],
  [emailMonitoringRoutes, { prefix: '/api/email-monitoring' }],
  [widgetApiRoutes, { prefix: '/widget-api' }],
  [testDataRoutes, { prefix: '/api/venues' }],
  [manageBookingRoutes, { prefix: '/manage' }],
]
