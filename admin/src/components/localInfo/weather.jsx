// src/components/localInfo/weather.jsx
//
// The weather pieces of Local info: Open-Meteo's weather codes as a picture,
// a day's hours as a strip (HourStrip), and what a weather entry adds under
// its row (WeatherMore): Recorded or Forecast, what was forecast for a
// recorded day, and the hours behind a "By the hour" button. A weather day's
// data (hours, recorded, forecast) is described in shared/localInfo.js.
// Recorded hours are grey, forecast hours dashed; a forecast hour shows its
// chance of rain, a recorded one how much fell.
import { useState } from 'react'
import { Sun, CloudSun, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { weatherText, weatherSummary, hourText } from '@shared/localInfo.js'

// Open-Meteo's WMO weather codes as a picture.
export function WeatherIcon({ code, className }) {
  const c = Number(code)
  const Icon = c === 0 ? Sun : c <= 2 ? CloudSun : c === 3 ? Cloud : c <= 48 ? CloudFog
    : c <= 57 ? CloudDrizzle : (c <= 67 || (c >= 80 && c <= 82)) ? CloudRain
    : (c <= 77 || c === 85 || c === 86) ? CloudSnow : c >= 95 ? CloudLightning : Cloud
  return <Icon className={className} aria-hidden="true" />
}

const mm = v => (v < 1 ? v.toFixed(1) : String(Math.round(v))) + ' mm'
const deg = v => (v == null ? '–' : Math.round(v) + '°')

/** Under the temperature: how much fell (recorded), or the chance of rain (forecast). */
function rainLine(x) {
  if (!x.recorded && x.precip_prob != null && x.precip_prob >= 20) return Math.round(x.precip_prob) + '%'
  return (x.precip_mm || 0) >= 0.1 ? mm(x.precip_mm) : ''
}

/** An hour in words, for its title and screen readers. */
function hourWords(x) {
  const parts = [hourText(x.h) + ': ' + weatherText(x.weather_code), deg(x.temp).replace('°', '°C')]
  if ((x.precip_mm || 0) >= 0.1) parts.push(mm(x.precip_mm) + (x.recorded ? '' : ' expected'))
  if (!x.recorded && x.precip_prob != null) parts.push(Math.round(x.precip_prob) + '% chance of rain')
  parts.push(x.recorded ? 'recorded' : 'forecast')
  if (x.recorded && x.forecast) parts.push('forecast was ' + weatherText(x.forecast.weather_code) + ', ' + deg(x.forecast.temp).replace('°', '°C'))
  return parts.join(', ')
}

/**
 * A day's hours side by side, scrolling sideways. from: the first hour shown
 * (the Today page starts just before now); every hour when left out.
 */
export function HourStrip({ hours, from = null, testId = 'weather-hours' }) {
  const list = (hours || []).filter(x => from == null || x.h >= from)
  if (!list.length) return null
  return (
    <div className="overflow-x-auto overscroll-x-contain" data-testid={testId}>
      <ul className="flex gap-1 w-max pb-1">
        {list.map(x => (
          <li key={x.h} title={hourWords(x)} data-testid="weather-hour" data-hour={x.h} data-recorded={x.recorded ? '1' : '0'}
            className={cn('w-14 shrink-0 rounded-md border px-1 py-1.5 flex flex-col items-center gap-1 text-center',
              x.recorded ? 'bg-muted/70 border-transparent' : 'bg-background border-dashed')}>
            <span className="text-[11px] font-medium leading-none">{hourText(x.h)}</span>
            <WeatherIcon code={x.weather_code} className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm font-semibold leading-none">{deg(x.temp)}</span>
            <span className="text-[11px] leading-none text-sky-800 min-h-[11px]">{rainLine(x)}</span>
            <span className="sr-only">{hourWords(x)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What the strip's two looks mean. */
export function HourLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-muted" /> Recorded</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm border border-dashed border-muted-foreground/60" /> Forecast (% is the chance of rain)</span>
    </p>
  )
}

/** First hour the Today page shows: the hour before the first one still ahead. */
export function hoursFrom(hours) {
  const next = (hours || []).find(x => !x.recorded)
  return next ? Math.max(0, next.h - 1) : null
}

/** A captured weather day is a forecast until it is over, then recorded. */
export function WeatherTag({ item }) {
  if (item.kind !== 'weather' || !item.source_id || !item.data) return null
  return item.data.recorded
    ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800" data-testid="weather-tag">Recorded</span>
    : <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground" data-testid="weather-tag">Forecast</span>
}

/** Under a captured weather day's row: what was forecast for it, and its hours. */
export function WeatherMore({ item }) {
  const [open, setOpen] = useState(false)
  const d = item.data || {}
  const hours = Array.isArray(d.hours) ? d.hours : []
  if (item.kind !== 'weather' || (!hours.length && !d.forecast)) return null
  return (
    <div className="mt-0.5">
      {d.recorded && d.forecast && (
        <p className="text-xs text-muted-foreground" data-testid="weather-forecast-was">Forecast was: {weatherSummary(d.forecast)}</p>
      )}
      {hours.length > 0 && (
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} data-testid="weather-hours-toggle"
          className="inline-flex items-center gap-1.5 min-h-[48px] px-2.5 -ml-2.5 rounded-lg text-xs font-medium text-primary hover:bg-muted touch-manipulation">
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
          {open ? 'Hide the hours' : 'By the hour'}
        </button>
      )}
      {open && (
        <div className="space-y-1.5 pb-1">
          <HourStrip hours={hours} />
          <HourLegend />
        </div>
      )}
    </div>
  )
}
