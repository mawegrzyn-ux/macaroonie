// Shared boxed-layout tokens for admin canvas + theme form.
// Keep in sync with api/src/views/site/shared/head.eta (--boxed-pad).

export const BOXED_STEPS = [
  { value: 1, label: '1', hint: 'Tight',        padPx: 16 },
  { value: 2, label: '2', hint: 'Default',      padPx: 24 },
  { value: 3, label: '3', hint: 'Comfortable',  padPx: 40 },
  { value: 4, label: '4', hint: 'Roomy',        padPx: 64 },
  { value: 5, label: '5', hint: 'Wide gutter',  padPx: 96 },
]

export const DEFAULT_BOXED_STEP = 2
export const DEFAULT_CONTAINER_MAX_PX = 1100

export function boxedPadPx(step) {
  const n = Number(step)
  const found = BOXED_STEPS.find(s => s.value === n)
  return found ? found.padPx : BOXED_STEPS[1].padPx
}

/** Inner wrapper style for a block. Theme --cw / --boxed-pad apply unless overridden. */
export function innerContainerStyle(container, boxedStep) {
  const pad = boxedStep ? `${boxedPadPx(boxedStep)}px` : 'var(--boxed-pad, 24px)'
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
