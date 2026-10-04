import { type ReactNode, useId } from 'react'
import { choice, cn } from '@/lib/utils'

// A row of radio buttons drawn as quiet words, the picked one starred: pick one of `options`. `children` go at the end
// of the row.
export function Choices<K extends string | number>({
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
    <fieldset className={cn('flex flex-wrap gap-x-6 gap-y-2', className)}>
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => (
        <label key={o.key} className={choice(o.key === value)}>
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
