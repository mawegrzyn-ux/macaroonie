// Theme layout knobs shown on Brand & theme: container max width + boxed inset.
import { BOXED_STEPS, DEFAULT_BOXED_STEP, DEFAULT_BOXED_STEPS, DEFAULT_CONTAINER_MAX_PX } from './boxedLayout'

export function BrandLayoutFields({ theme, setPath }) {
  const cw = theme?.spacing?.container_max_px ?? DEFAULT_CONTAINER_MAX_PX
  const step = theme?.spacing?.boxed_step ?? DEFAULT_BOXED_STEP
  const mobileStep = theme?.spacing?.boxed_step_mobile ?? null
  const steps = (Array.isArray(theme?.spacing?.boxed_steps) && theme.spacing.boxed_steps.length === DEFAULT_BOXED_STEPS.length)
    ? theme.spacing.boxed_steps
    : DEFAULT_BOXED_STEPS

  function setStepValue(idx, patch) {
    const next = steps.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    setPath('spacing', 'boxed_steps', next)
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium">Container max width</p>
          <span className="text-xs text-muted-foreground font-mono">{cw}px</span>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Boxed blocks stay within this width and sit centred. Default 1100. Full-bleed blocks ignore it.
        </p>
        <input type="range" min={640} max={1600} step={20} value={cw}
          onChange={e => setPath('spacing', 'container_max_px', Number(e.target.value))}
          className="w-full accent-primary" />
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Boxed inset — step values</p>
        <p className="text-xs text-muted-foreground mb-2">
          Define what each of the 5 steps below means for this site. Mix units freely — e.g. step 1
          could be a fixed 20px while step 3 is 5% of the block width.
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {steps.map((s, idx) => (
            <div key={idx} className="border rounded-md p-1.5">
              <p className="text-[10px] text-muted-foreground text-center mb-1">Step {idx + 1}</p>
              <input
                type="number" min={0} max={200} value={s.value}
                onChange={e => setStepValue(idx, { value: Math.max(0, Math.min(200, Number(e.target.value))) })}
                className="w-full h-9 rounded border bg-background px-1.5 text-sm text-center touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <select
                value={s.unit}
                onChange={e => setStepValue(idx, { unit: e.target.value })}
                className="w-full h-8 mt-1 rounded border bg-background text-xs text-center touch-manipulation focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="px">px</option>
                <option value="%">%</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-1">Boxed inset — default step</p>
        <p className="text-xs text-muted-foreground mb-2">
          Side padding inside boxed (and wide) blocks. Blocks can override this in the inspector.
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {BOXED_STEPS.map(s => {
            const cfg = steps[s.value - 1]
            return (
              <button key={s.value} type="button"
                onClick={() => setPath('spacing', 'boxed_step', s.value)}
                title={`${s.hint} — ${cfg.value}${cfg.unit} each side`}
                className={`text-sm border rounded-md py-2 min-h-[40px] ${
                  Number(step) === s.value
                    ? 'bg-primary/10 border-primary text-primary font-medium'
                    : 'hover:bg-accent'}`}>
                <span className="block leading-none">{s.label}</span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">{cfg.value}{cfg.unit}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <p className="text-sm font-medium mb-1">Boxed inset — mobile portrait override</p>
        <p className="text-xs text-muted-foreground mb-2">
          Optional. Applies only on narrow phone screens held upright (≤600px wide, portrait) — every
          other size (desktop, tablet, phone landscape) keeps using the default above.
        </p>
        <div className="grid grid-cols-6 gap-1.5">
          <button type="button"
            onClick={() => setPath('spacing', 'boxed_step_mobile', null)}
            title="Use the default above at every width"
            className={`text-xs border rounded-md py-2 min-h-[40px] ${
              mobileStep == null
                ? 'bg-primary/10 border-primary text-primary font-medium'
                : 'hover:bg-accent'}`}>
            <span className="block leading-none">Default</span>
          </button>
          {BOXED_STEPS.map(s => {
            const cfg = steps[s.value - 1]
            return (
              <button key={s.value} type="button"
                onClick={() => setPath('spacing', 'boxed_step_mobile', s.value)}
                title={`${s.hint} — ${cfg.value}${cfg.unit} each side`}
                className={`text-sm border rounded-md py-2 min-h-[40px] ${
                  mobileStep === s.value
                    ? 'bg-primary/10 border-primary text-primary font-medium'
                    : 'hover:bg-accent'}`}>
                <span className="block leading-none">{s.label}</span>
                <span className="block text-[10px] text-muted-foreground mt-0.5">{cfg.value}{cfg.unit}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
