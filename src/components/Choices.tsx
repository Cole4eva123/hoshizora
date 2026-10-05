import { type ReactNode, useId } from 'react'
import { choice, cn } from '@/lib/utils'

// A row of radio buttons drawn as quiet words, the picked one starred: pick one of `options`. Given a list as `value`,
// they're checkboxes, each picked one starred, and `onChange` gets the one flipped. `children` go at the end of the row.
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
  value: K | K[]
  onChange: (key: K) => void
  className?: string
  children?: ReactNode
}) {
  const name = useId()
  const many = Array.isArray(value)
  return (
    <fieldset className={cn('flex flex-wrap gap-x-6 gap-y-2', className)}>
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => {
        const picked = many ? value.includes(o.key) : o.key === value
        return (
          <label key={o.key} className={choice(picked)}>
            <input
              type={many ? 'checkbox' : 'radio'}
              name={name}
              checked={picked}
              onChange={() => onChange(o.key)}
              className="sr-only"
            />
            {o.label}
          </label>
        )
      })}
      {children}
    </fieldset>
  )
}
