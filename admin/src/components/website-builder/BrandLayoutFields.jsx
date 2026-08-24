// Theme layout knobs shown on Brand & theme: container max width + boxed inset.
import { BOXED_STEPS, DEFAULT_BOXED_STEP, DEFAULT_CONTAINER_MAX_PX } from './boxedLayout'

export function BrandLayoutFields({ theme, setPath }) {
  const cw = theme?.spacing?.container_max_px ?? DEFAULT_CONTAINER_MAX_PX
  const step = theme?.spacing?.boxed_step ?? DEFAULT_BOXED_STEP

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
        <p className="text-sm font-medium mb-1">Boxed inset</p>
        <p className="text-xs text-muted-foreground mb-2">
          Side padding inside boxed (and wide) blocks. Blocks can override this in the inspector.
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {BOXED_STEPS.map(s => (
            <button key={s.value} type="button"
              onClick={() => setPath('spacing', 'boxed_step', s.value)}
              title={`${s.hint} — ${s.padPx}px each side`}
              className={`text-sm border rounded-md py-2 min-h-[40px] ${
                Number(step) === s.value
                  ? 'bg-primary/10 border-primary text-primary font-medium'
                  : 'hover:bg-accent'}`}>
              <span className="block leading-none">{s.label}</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">{s.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
