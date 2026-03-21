// src/lib/utils.js
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatTime(iso) {
  return format(typeof iso === 'string' ? parseISO(iso) : iso, 'HH:mm')
}

export function formatDate(iso) {
  return format(typeof iso === 'string' ? parseISO(iso) : iso, 'EEE d MMM yyyy')
}

export function formatDateTime(iso) {
  return format(typeof iso === 'string' ? parseISO(iso) : iso, 'EEE d MMM, HH:mm')
}

export const STATUS_LABELS = {
  unconfirmed:     'Not confirmed',
  confirmed:       'Confirmed',
  reconfirmed:     'Re-confirmed',
  pending_payment: 'Pending payment',
  arrived:         'Arrived',
  seated:          'Seated',
  checked_out:     'Checked out',
  cancelled:       'Cancelled',
  no_show:         'No show',
}

export const STATUS_COLOURS = {
  unconfirmed:     'bg-amber-100 text-amber-800',
  confirmed:       'bg-blue-100 text-blue-800',
  reconfirmed:     'bg-indigo-100 text-indigo-800',
  pending_payment: 'bg-yellow-100 text-yellow-800',
  arrived:         'bg-cyan-100 text-cyan-800',
  seated:          'bg-green-100 text-green-800',
  checked_out:     'bg-green-50 text-green-600',
  cancelled:       'bg-red-100 text-red-800',
  no_show:         'bg-gray-100 text-gray-700',
}

export const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
export const INTERVALS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
]
