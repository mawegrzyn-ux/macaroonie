// The kiosk's start screen: photos or videos from the design, the logo and
// headline, the languages as flags, "Staying or going?" with the kiosk's
// order types (its revenue stream's, Till setup), and the allergens list.

import { useEffect, useRef, useState } from 'react'
import { ShieldAlert, WifiOff } from 'lucide-react'
import { TK, KIOSK_LANGUAGES } from '@shared/kiosk.js'
import { useKiosk, textsFor, setLang, startOrder, go, methods } from './store.js'
import { cx, Flag, TypeIcon, guessTypeIcon } from './parts.jsx'

function Media({ media, secs }) {
  const [i, setI] = useState(0)
  const video = useRef(null)
  const item = media[i % Math.max(1, media.length)]
  useEffect(() => {
    if (!item || item.type === 'video' || media.length < 2) return
    const id = setTimeout(() => setI(n => (n + 1) % media.length), secs * 1000)
    return () => clearTimeout(id)
  }, [item, media.length, secs])
  if (!item) return null
  if (item.type === 'video') {
    return <video key={item.url} ref={video} src={item.url} className="absolute inset-0 w-full h-full object-cover" autoPlay muted playsInline
      loop={media.length < 2} onEnded={() => setI(n => (n + 1) % media.length)} />
  }
  return <img key={item.url} src={item.url} alt="" className="absolute inset-0 w-full h-full object-cover k-fade" draggable={false} />
}

export function Languages({ design, lang, onPick, size = 'normal' }) {
  const list = KIOSK_LANGUAGES.filter(l => design.languages.enabled.includes(l.code))
  if (list.length < 2) return null
  return (
    <div className="flex flex-wrap justify-center gap-[1em]" data-testid="k-languages">
      {list.map(l => (
        <button key={l.code} onClick={() => onPick(l.code)} aria-label={l.name} data-lang={l.code}
          className={cx('flex flex-col items-center gap-[.3em] bg-transparent border-0 p-[.2em]', lang === l.code && 'k-lang-on')}>
          <span style={size === 'big' ? { fontSize: '1.25em' } : null}><Flag code={l.code} /></span>
          <span className="text-[.75em] font-semibold">{l.name}</span>
        </button>
      ))}
    </div>
  )
}

export default function Start() {
  const s = useKiosk()
  const { config } = s
  const texts = textsFor(s)
  const { t, ui } = texts
  const d = config.design
  const types = config.order_types || []
  const canPay = methods(config).length > 0
  const closed = (!s.online && !s.preview) || !canPay
  const headline = d.start.headline ? t(TK.design(d.id, 'headline'), d.start.headline) : ui('order_here')
  const question = d.start.question ? t(TK.design(d.id, 'question'), d.start.question) : ui('staying_or_going')
  const typeLabel = ty => {
    const card = d.start.type_cards[ty.id]
    return card?.label ? t(TK.design(d.id, 'type:' + ty.id), card.label) : t(TK.type(ty.id), ty.name)
  }
  const full = d.start.layout === 'full'
  const hasMedia = d.start.media.length > 0

  const choose = (
    <div className="flex flex-col items-center gap-[calc(var(--k-pad)*1.1)] w-full">
      {d.brand.logo_url && <img src={d.brand.logo_url} alt="" className="max-h-[11vh] max-w-[60%] object-contain" draggable={false} />}
      <h1 className="k-head text-[2.6em] m-0 text-center">{headline}</h1>
      {closed ? (
        <div className="k-card p-[var(--k-pad)] max-w-[640px] text-center flex flex-col items-center gap-[.6em] text-[var(--k-text)]" data-testid="k-closed">
          <WifiOff size={40} />
          <div className="k-head text-[1.4em]">{ui('closed_title')}</div>
          <div>{ui('closed_body')}</div>
        </div>
      ) : types.length > 1 ? (
        <>
          <div className="k-head text-[1.6em] text-center">{question}</div>
          <div className="grid gap-[var(--k-pad)] w-full max-w-[900px]" style={{ gridTemplateColumns: 'repeat(' + Math.min(types.length, 3) + ', minmax(0, 1fr))' }}>
            {types.map(ty => {
              const card = d.start.type_cards[ty.id] || {}
              const icon = card.icon && card.icon !== 'none' ? card.icon : guessTypeIcon(ty.name)
              return (
                <button key={ty.id} className="k-card k-btn-primary flex flex-col items-center justify-center gap-[.6em] p-[var(--k-pad)] min-h-[22vmin] border-0 overflow-hidden relative"
                  onClick={() => startOrder(ty.id)} data-testid="k-type" data-type={ty.id}
                  style={{ background: 'var(--k-primary)', color: 'var(--k-primary-text)' }}>
                  {card.image_url
                    ? <img src={card.image_url} alt="" className="w-[45%] aspect-square object-contain" draggable={false} />
                    : <TypeIcon icon={icon} size={64} />}
                  <span className="k-head text-[1.5em]">{typeLabel(ty)}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <button className="k-btn k-btn-primary k-btn-big text-[1.5em] min-w-[50%]" onClick={() => startOrder(types[0]?.id || null)} data-testid="k-type">
          {ui('start_order')}
        </button>
      )}
      <Languages design={d} lang={texts.lang} onPick={setLang} size="big" />
      {d.start.show_allergens && (
        <button className="k-btn k-btn-ghost underline" onClick={() => go('allergens', { orderType: s.orderType })} data-testid="k-allergens-button">
          <ShieldAlert /> {ui('allergens')}
        </button>
      )}
    </div>
  )

  if (full && hasMedia) {
    return (
      <div className="absolute inset-0" data-testid="k-start">
        <Media media={d.start.media} secs={d.start.media_secs} />
        <div className="absolute inset-x-0 bottom-0 p-[var(--k-pad)] pt-[12vh]" style={{ background: 'linear-gradient(to top, var(--k-bg) 55%, transparent)' }}>
          {choose}
        </div>
      </div>
    )
  }
  // Split: photos above the choices on a portrait screen, beside them on a landscape one.
  return (
    <div className="absolute inset-0 flex flex-col landscape:flex-row" data-testid="k-start">
      {hasMedia && <div className="relative h-[46%] landscape:h-auto landscape:w-1/2 shrink-0 overflow-hidden"><Media media={d.start.media} secs={d.start.media_secs} /></div>}
      <div className="flex-1 min-h-0 min-w-0 k-scroll flex flex-col p-[var(--k-pad)]"><div className="m-auto w-full">{choose}</div></div>
    </div>
  )
}
