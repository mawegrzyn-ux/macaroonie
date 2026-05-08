// canvas/ThemeFrame.jsx
//
// Wraps the page-builder canvas with the same CSS variables + base
// typography as the public site (api/src/views/site/shared/head.eta).
// Block components use these vars directly (var(--c-primary), etc.) so
// what the operator sees in the canvas matches the rendered page.
//
// The styles are SCOPED to `.page-canvas-frame` so they don't leak into
// the surrounding admin chrome. We use a unique attribute for the scope
// so even nested admin elements (modals, popovers) don't accidentally
// inherit the theme's font.

import { useEffect, useMemo, useRef } from 'react'
import { resolveTheme } from './themeResolver'

let _styleCount = 0
function nextScopeId() { _styleCount += 1; return `pcf-${_styleCount}` }

export function ThemeFrame({ config, children, className = '' }) {
  const scopeId = useMemo(nextScopeId, [])
  const t = useMemo(() => resolveTheme(config), [config])
  const styleRef = useRef(null)

  // Inject Google Fonts <link> once for the active heading + body fonts.
  useEffect(() => {
    if (!t.googleFontsUrl) return
    const id = `pcf-fonts-${t.googleFontsUrl.length}`
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = t.googleFontsUrl
    document.head.appendChild(link)
  }, [t.googleFontsUrl])

  const css = `
    .${scopeId} {
      --c-primary:    ${t.primary};
      --c-accent:     ${t.accent};
      --c-bg:         ${t.background};
      --c-surface:    ${t.surface};
      --c-text:       ${t.textColor};
      --c-muted:      ${t.mutedColor};
      --c-border:     ${t.border};

      --f-heading: "${t.headingFont}", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      --f-body:    "${t.bodyFont}",    system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      --fs-base:   ${t.baseSize}px;
      --fs-h1:     calc(var(--fs-base) * ${Math.pow(t.hScale, 3).toFixed(2)});
      --fs-h2:     calc(var(--fs-base) * ${Math.pow(t.hScale, 2).toFixed(2)});
      --fs-h3:     calc(var(--fs-base) * ${t.hScale.toFixed(2)});
      --fw-heading: ${t.hWeight};
      --fw-body:    ${t.bWeight};
      --lh:         ${t.lineHeight};
      --ls:         ${t.letterSp};

      --cw:   ${t.containerMax}px;
      --sy:   ${t.sectionY}px;
      --sy-m: ${t.sectionYMob}px;
      --gap:  ${t.gap}px;

      --r-sm: ${t.rSm}px;
      --r-md: ${t.rMd}px;
      --r-lg: ${t.rLg}px;

      --logo-h: ${t.logoH}px;
      --btn-r:  ${t.btnR}px;
      --btn-py: ${t.btnPy}px;
      --btn-px: ${t.btnPx}px;
      --btn-w:  ${t.btnW};

      --hero-overlay: ${t.heroOpacity};
      --hero-minh:    ${t.heroMinH}px;

      background: var(--c-bg);
      color: var(--c-text);
      font-family: var(--f-body);
      font-size: var(--fs-base);
      font-weight: var(--fw-body);
      line-height: var(--lh);
      letter-spacing: var(--ls);
    }
    .${scopeId} *,
    .${scopeId} *::before,
    .${scopeId} *::after { box-sizing: border-box; }
    .${scopeId} h1, .${scopeId} h2, .${scopeId} h3, .${scopeId} h4 {
      font-family: var(--f-heading);
      font-weight: var(--fw-heading);
      margin: 0;
      line-height: 1.15;
    }
    .${scopeId} h1 { font-size: var(--fs-h1); }
    .${scopeId} h2 { font-size: var(--fs-h2); }
    .${scopeId} h3 { font-size: var(--fs-h3); }
    .${scopeId} p  { margin: 0 0 1em; }
    .${scopeId} p:last-child { margin-bottom: 0; }
    .${scopeId} img { max-width: 100%; display: block; }
    .${scopeId} a { color: var(--c-primary); text-decoration: none; }
    .${scopeId} a:hover { text-decoration: underline; }
    .${scopeId} .container { max-width: var(--cw); margin: 0 auto; padding: 0 24px; }
    .${scopeId} .btn {
      display: inline-block;
      padding: var(--btn-py) var(--btn-px);
      background: var(--c-primary); color: #fff;
      border-radius: var(--btn-r);
      font-weight: var(--btn-w);
      font-size: 15px; text-decoration: none;
      border: none; cursor: pointer; transition: opacity .2s;
    }
    .${scopeId} .btn:hover { opacity: 0.9; text-decoration: none; }
    .${scopeId} .btn-outline {
      background: transparent; color: var(--c-primary);
      border: 2px solid var(--c-primary);
    }
    .${scopeId} section.block { padding: var(--sy) 0; }
    .${scopeId} section.block h2 { color: var(--c-primary); margin-bottom: calc(var(--gap) * 0.75); }
    .${scopeId} .prose ul, .${scopeId} .prose ol { padding-left: 1.4em; margin: 0 0 1em; }
    .${scopeId} .prose li { margin: 0.25em 0; }
    .${scopeId} .prose blockquote {
      margin: 0 0 1em;
      padding-left: 1em;
      border-left: 3px solid var(--c-border);
      color: var(--c-muted);
    }
    .${scopeId} [contenteditable="true"]:focus { outline: none; }
    .${scopeId} [data-pcf-placeholder]:empty::before {
      content: attr(data-pcf-placeholder);
      color: var(--c-muted);
      opacity: 0.6;
    }
    .${scopeId} .pcf-block:hover .pcf-drag-handle { opacity: 1; }
    .${scopeId} .pcf-block:not([data-selected="true"]):hover {
      outline-color: rgba(99, 8, 18, 0.35) !important;
    }
    .${scopeId} .ProseMirror { outline: none; min-height: 1.4em; }
    .${scopeId} .ProseMirror p:empty::before {
      content: '\\200B';
      display: inline-block;
    }
    @media (max-width: 700px) {
      .${scopeId} section.block { padding: var(--sy-m) 0; }
    }
  `

  // Template-specific overlays — applied only when the active site template
  // expects them. Keeps the admin canvas visually aligned with the SSR
  // output for templates that have their own signature aesthetic.
  const templateKey = config?.template_key || 'classic'
  const templateCss = templateKey === 'onethai' ? onethaiCss(scopeId) : ''

  return (
    <div className={`${scopeId} ${className}`} ref={styleRef}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {templateCss && <style dangerouslySetInnerHTML={{ __html: templateCss }} />}
      {/* Make sure the Onethai Google Fonts are loaded when the canvas
          previews that template — they're already in the global font list,
          but operators may be on default theme fonts. */}
      {templateKey === 'onethai' && (
        <link rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Caveat:wght@400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&display=swap" />
      )}
      {children}
    </div>
  )
}

// Onethai overlay — mirrors the SSR rules in
// api/src/views/site/templates/onethai/partials/styles.eta so the admin
// canvas matches what gets rendered live. Asset paths are absolute (the
// admin and the API share the macaroonie.com origin in production).
function onethaiCss(scopeId) {
  const ASSETS = '/template-assets/onethai'
  return `
    .${scopeId} {
      --plum:        var(--c-primary, #630812);
      --plum-deep:   #4a060e;
      --plum-soft:   #7a1a26;
      --chilli:      var(--c-accent,  #c9302c);
      --herb:        #6b8e4e;
      --cream:       #f5efe6;
      --paper:       var(--c-bg,      #faf6ef);
      --paper-warm:  var(--c-surface, #f3ead8);
      --line:        rgba(99, 8, 18, 0.18);
      --hl-soft:     #f5b8c0;
      background:    var(--paper);
    }
    .${scopeId} h1, .${scopeId} h2, .${scopeId} h3 {
      font-family: 'Fraunces', serif;
      letter-spacing: -0.02em;
    }
    .${scopeId} section.block h1,
    .${scopeId} section.block h2,
    .${scopeId} section.block h3 {
      color: var(--plum);
    }
    /* Hero heading typography — keep tight leading + lighter weight */
    .${scopeId} section.block.hero h1 { font-weight: 400; line-height: 1.0; }

    /* Heading dotted-line ornament above section h2s (One Thai signature) */
    .${scopeId} section.block > div > h2:first-child::before,
    .${scopeId} section.block > .container > h2:first-child::before {
      content: "";
      display: block;
      width: 32px; height: 1px;
      background: var(--plum);
      opacity: 0.6;
      margin: 0 auto 14px;
    }

    /* Booking widget block — cream surface */
    .${scopeId} section.block#booking,
    .${scopeId} section.block.block-booking_widget {
      background: var(--paper-warm);
    }

    /* CTAs — pill-shape (One Thai signature) */
    .${scopeId} section.block a[style*="background:#fff"],
    .${scopeId} section.block a[style*="background: #fff"],
    .${scopeId} section.block span[style*="background:var(--c-primary)"],
    .${scopeId} section.block span[style*="background: var(--c-primary)"] {
      border-radius: 999px;
      padding: 14px 28px;
    }
  `
}
