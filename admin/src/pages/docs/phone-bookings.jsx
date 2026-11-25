// src/pages/docs/phone-bookings.jsx
// The Docs page's "Bookings on the phone" section. Docs.jsx gathers every file in this
// folder (except parts.jsx) and shows them by order, then id.
import { H2, H3, P, Mono, DataTable } from './parts.jsx'

export const id = 'phone-bookings'
export const label = 'Bookings on the phone'
export const order = 211

export function Section() {
  return (
    <section id="phone-bookings" data-doc="">
      <H2>Bookings on the phone</H2>
      <P>
        Two phone pages (routes in <Mono>routes/bookings.jsx</Mono>, shell <Mono>mobile</Mono>; hub
        tiles <Mono>timeline</Mono> and <Mono>guest-list</Mono> in <Mono>mobile/registry.js</Mono>{' '}
        with <Mono>module: 'bookings'</Mono>) and the parts they share in{' '}
        <Mono>components/bookings/phone.jsx</Mono>. No new route: they call what the office does.
      </P>
      <DataTable
        head={['File', 'What it is']}
        rows={[
          ['pages/mobile/MobileTimeline.jsx', '/mobile/timeline: a row per table (sort order; the unallocated row only when used), bookings as blocks along an hour axis (HOUR_W 120 px) that scrolls sideways with a sticky table column; a combination shows on each member table (member_table_ids). The axis runs from the first sitting or booking to the last sitting\'s close plus 90 minutes or the last booking\'s end (GET /venues/:id/schedule/sittings-for-date). Today opens at now minus an hour with a red line at now. Cancelled and no-show hidden unless asked.'],
          ['pages/mobile/MobileGuestList.jsx', '/mobile/guest-list: the day by time, search (name, or 3+ digits of the phone), status chips (Still to come = not INACTIVE_STATUSES), Arrived / Seated on the row when statusChoices() offers them and the booking is before them.'],
          ['components/bookings/phone.jsx', 'usePhoneVenue() (picked: maca_phone_bookings_venue, else the shared device\'s venue, else maca_today_venue, else the first), venueToday(tz), useDayBookings() (query key [\'bookings\', venue, date], the office Timeline\'s and Bookings page\'s, plus useRealtimeBookings()), useSetStatus() (PATCH /bookings/:id/status), allergyIn() (the 14 allergens and allergy words in guest or staff notes), VenueDayBar (the day as a button over an invisible date input), BookingSheet, NewBookingSheet.'],
          ['components/bookings/statuses.js', 'SELECTABLE_STATUSES, statusChoices(rules, current) and INACTIVE_STATUSES: the one rule for which statuses a venue offers (enable_unconfirmed_flow, enable_reconfirmed_status, enable_arrived_status), used by BookingDrawer, the Bookings page and the phone.'],
          ['components/bookings/PhoneBadge.jsx', 'TodayBookingsBadge: the Guest list tile\'s count of today\'s bookings still on (public in areas.json; the registry\'s Badge, drawn by MobileHub when the Today feed gives the tile no badge).'],
        ]}
      />
      <H3>A new booking</H3>
      <P>
        <Mono>NewBookingSheet</Mono> is the office New booking's slot path: covers within the
        venue's <Mono>min_covers</Mono> / <Mono>max_covers</Mono>, times from{' '}
        <Mono>GET /venues/:id/slots?date=&amp;covers=</Mono> (available ones with a table or
        combination), a tap holds it (<Mono>POST /bookings/holds</Mono> with the slot's{' '}
        <Mono>table_id</Mono> or <Mono>combination_id</Mono> and the office's stand-in name and
        email), Book confirms (<Mono>POST /bookings</Mono>, status <Mono>confirmed</Mono> as the
        office's default, the email only when typed, so a booking without one keeps the hold's
        stand-in address). A new time, day, covers or venue, Cancel and leaving delete the hold
        (<Mono>DELETE /bookings/holds/:id</Mono>). Times that need another booking moved, a chosen
        table and walk-ins stay with the office's New booking.
      </P>
    </section>
  )
}
