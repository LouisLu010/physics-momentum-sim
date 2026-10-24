import { useEffect, useId, useRef, useState } from 'react'

const iconPaths = {
  play: <path d="m8 5 11 7-11 7Z" />,
  pause: <><path d="M8 5v14M16 5v14" /></>,
  reset: <><path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7" /></>,
  link: <><path d="m9 15 6-6M8 12l-2 2a4 4 0 0 0 6 6l3-3M16 12l2-2a4 4 0 0 0-6-6l-3 3" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></>,
  ball: <><circle cx="12" cy="12" r="8" /><path d="M8 10a4 4 0 0 1 3-2" /></>,
  block: <rect x="4" y="6" width="16" height="12" rx="2" />,
  arc: <><path d="M3 7a9 9 0 0 0 18 0M5 7a7 7 0 0 0 14 0" /></>,
  rod: <><path d="m6 18 12-12" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /></>,
  rope: <><circle cx="3" cy="5" r="1" /><path d="M4 6c1 12 15 12 16 0" /><circle cx="21" cy="5" r="1" /></>,
  spring: <path d="M2 12h3l2-5 3 10 4-10 3 10 2-5h3" />,
  ground: <><path d="M2 9h20M5 10l-3 5M10 10l-3 5M15 10l-3 5M20 10l-3 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1-1.5 2M12 16v.1" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  select: <path d="m5 3 14 10-7 1-3 7Z" />,
  zoomIn: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6M10 7v6" /></>,
  zoomOut: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6" /></>,
  fit: <><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></>,
  step: <><path d="m5 5 10 7-10 7ZM19 5v14" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></>,
  undo: <><path d="m8 4-5 5 5 5M3 9h11a7 7 0 0 1 0 14" /></>,
  pencil: <><path d="m4 16 11-11 4 4L8 20H4ZM13 7l4 4" /></>,
}

export function Icon({ name, size = 18, className = '', ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`ui-icon ${className}`.trim()}
      {...props}
    >
      {iconPaths[name] || iconPaths.select}
    </svg>
  )
}

function numberText(value) {
  return Number.isFinite(value) ? String(Number(value.toFixed(4))) : '0'
}

export function NumberField({ label, value, onChange, suffix, min = -10000, max = 10000, step = 0.1, disabled = false }) {
  const id = useId()
  const [draft, setDraft] = useState(() => numberText(value))
  const focused = useRef(false)
  const cancel = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    if (!focused.current) setDraft(numberText(value))
  }, [value])

  const commit = () => {
    focused.current = false
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft)
    if (cancel.current || !dirty.current || !Number.isFinite(parsed)) {
      cancel.current = false
      dirty.current = false
      setDraft(numberText(value))
      return
    }
    const valid = Math.max(min, Math.min(max, parsed))
    dirty.current = false
    setDraft(numberText(valid))
    if (valid !== value) onChange(valid)
  }

  return (
    <label className="property-field" htmlFor={id}>
      <span>{label}</span>
      <div>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onFocus={() => { focused.current = true; dirty.current = false }}
          onChange={(event) => { dirty.current = true; setDraft(event.target.value) }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              cancel.current = true
              event.currentTarget.blur()
            }
          }}
        />
        {suffix && <em>{suffix}</em>}
      </div>
    </label>
  )
}

export function SelectField({ label, value, onChange, children, disabled = false }) {
  const id = useId()
  return (
    <label className="select-field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value || ''} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{children}</select>
    </label>
  )
}

export function Toggle({ checked, onChange, label, detail, disabled = false }) {
  const id = useId()
  return (
    <label className="toggle-row" htmlFor={id}>
      <span>
        <span className="toggle-label">{label}</span>
        {detail && <span className="toggle-detail">{detail}</span>}
      </span>
      <input id={id} type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch" aria-hidden="true"><span /></span>
    </label>
  )
}
