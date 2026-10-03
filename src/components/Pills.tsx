import { type ReactNode, useId } from 'react'
import { cn, pill } from '@/lib/utils'

// A row of radio buttons drawn as pills: pick one of `options`. `children` go at the end of the row.
export function Pills<K extends string | number>({
  legend,
  options,
  value,
  onChange,
  className,
  children,
}: {
  legend: string
  options: { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
  className?: string
  children?: ReactNode
}) {
  const name = useId()
  return (
    <fieldset className={cn('flex flex-wrap gap-2', className)}>
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.key}
          className={cn(pill(o.key === value), 'has-focus-visible:outline-2 has-focus-visible:outline-primary')}
        >
          <input
            type="radio"
            name={name}
            checked={o.key === value}
            onChange={() => onChange(o.key)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
      {children}
    </fieldset>
  )
}
