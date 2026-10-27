// Printing from the till itself, until the venue hub prints to the network
// printers (docs/POS.md). Print operations (shared/pos/tickets.js) become an
// 80mm page in a hidden frame and go to the browser's print dialog, so a
// tablet with a printer set up in Android or Windows can print bills and
// receipts now. The same operations will go to the hub as ESC/POS later.
// Inside the Android app the page goes to Android's print service instead.

import { opsHtml, PRINT_CSS as CSS } from '@shared/pos/ticketHtml.js'
import { tellApp } from './nativeApp.js'

/** Print one or more tickets (each a list of operations). */
export function printTickets(tickets) {
  const list = (tickets || []).filter(t => t && t.length)
  if (!list.length) return
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + CSS + '</style></head><body>' + list.map(opsHtml).join('') + '</body></html>'
  // In the Android app the page can't print itself: Android's print service does.
  if (tellApp({ type: 'macaroonie:print', html })) return
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(html)
  doc.close()
  setTimeout(() => {
    try { frame.contentWindow.focus(); frame.contentWindow.print() } catch { /* printing not available */ }
    setTimeout(() => frame.remove(), 60_000)
  }, 150)
}
