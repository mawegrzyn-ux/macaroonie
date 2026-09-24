// Shared boxed-layout tokens for admin canvas + theme form.
// Keep in sync with api/src/views/site/shared/head.eta (--boxed-pad).

export const BOXED_STEPS = [
  { value: 1, label: '1', hint: 'Tight' },
  { value: 2, label: '2', hint: 'Default' },
  { value: 3, label: '3', hint: 'Comfortable' },
  { value: 4, label: '4', hint: 'Roomy' },
  { value: 5, label: '5', hint: 'Wide gutter' },
]

export const DEFAULT_BOXED_STEP = 2
export const DEFAULT_CONTAINER_MAX_PX = 1100

// Default value+unit for each of the 5 steps, mirroring head.eta's
// DEFAULT_BOXED_STEPS. A tenant can override this whole array via
// theme.spacing.boxed_steps (see BrandLayoutFields.jsx) — the *number*
// (1-5) referenced everywhere (theme default, mobile override, per-block
// override) always indexes into whichever array is active. Each step may
// also carry `mobile_value`/`mobile_unit` — optional, falls back to the
// desktop value/unit when unset — so a step can resolve differently on
// phone portrait (e.g. step 1 = 16px desktop, 8px mobile).
export const DEFAULT_BOXED_STEPS = [
  { value: 16, unit: 'px' },
  { value: 24, unit: 'px' },
  { value: 40, unit: 'px' },
  { value: 64, unit: 'px' },
  { value: 96, unit: 'px' },
]

// The tenant's actual step values for the site currently open in the page
// builder. Set once per canvas render by themeResolver.js (the single
// place that resolves `config.theme` into canvas-ready values) so that
// per-block boxed_step overrides — computed inline as plain px/% strings
// deep inside blockCanvas.jsx / siteBlocks.jsx / dataBlocks.jsx, not via
// CSS custom properties — reflect the tenant's real values instead of the
// hardcoded defaults. This is deliberately a module-level variable rather
// than React Context: there is only ever one <ThemeFrame> mounted at a
// time in this app (the page-builder canvas), so there's no risk of two
// different tenants' steps colliding. If a second concurrent canvas is
// ever added, this needs to become a Context instead.
let currentBoxedSteps = DEFAULT_BOXED_STEPS

export function setBoxedSteps(steps) {
  currentBoxedSteps = (Array.isArray(steps) && steps.length === DEFAULT_BOXED_STEPS.length)
    ? steps : DEFAULT_BOXED_STEPS
}

/** CSS length string ("24px" / "5%") for a 1-5 step number. */
export function boxedPadCss(step) {
  const n = Number(step)
  const cfg = currentBoxedSteps[n - 1] || currentBoxedSteps[DEFAULT_BOXED_STEP - 1]
  return `${cfg.value}${cfg.unit || 'px'}`
}

/** var(--boxed-step-N) reference for a 1-5 step number — resolves through
 *  the shared CSS variables emitted by boxedStepVarsCss(), so it responds
 *  to the mobile override media query automatically. */
export function boxedStepVarCss(step) {
  const n = Number(step) || DEFAULT_BOXED_STEP
  return `var(--boxed-step-${n})`
}

/** `:root`-block CSS declaring all 5 --boxed-step-N variables at their
 *  desktop value. Mirrors head.eta's boxedStepVarsCss. */
export function boxedStepVarsCss() {
  return currentBoxedSteps.map((cfg, i) => `--boxed-step-${i + 1}: ${cfg.value}${cfg.unit || 'px'};`).join('\n')
}

/** Media-query-block CSS overriding --boxed-step-N for any step that has
 *  its own mobile_value set. Empty string when none do. */
export function boxedStepMobileVarsCss() {
  return currentBoxedSteps
    .map((cfg, i) => cfg.mobile_value != null
      ? `--boxed-step-${i + 1}: ${cfg.mobile_value}${cfg.mobile_unit || cfg.unit || 'px'};`
      : '')
    .filter(Boolean)
    .join('\n')
}

/** @deprecated use boxedPadCss — kept only for any straggling px-only callers. */
export function boxedPadPx(step) {
  const n = Number(step)
  const cfg = currentBoxedSteps[n - 1] || currentBoxedSteps[DEFAULT_BOXED_STEP - 1]
  return cfg.value
}

/** Inner wrapper style for a block. Theme --cw / --boxed-pad apply unless overridden. */
export function innerContainerStyle(container, boxedStep) {
  const pad = boxedStep ? boxedPadCss(boxedStep) : 'var(--boxed-pad, 24px)'
  switch (container) {
    case 'wide':
      return {
        maxWidth: 1400,
        marginLeft: 'auto',
        marginRight: 'auto',
        paddingLeft: pad,
        paddingRight: pad,
        width: '100%',
      }
    case 'full':
      return {
        maxWidth: 'none',
        width: '100%',
        paddingLeft: pad,
        paddingRight: pad,
      }
    case 'boxed':
    default:
      return {
        maxWidth: 'var(--cw)',
        marginLeft: 'auto',
        marginRight: 'auto',
        paddingLeft: pad,
        paddingRight: pad,
        width: '100%',
      }
  }
}
