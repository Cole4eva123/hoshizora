import { type ReactNode, useId } from 'react'
import { ArrowDownUp } from 'lucide-react'
import { Constellation, type Star } from '@/components/Constellation'
import { useT } from '@/lib/i18n'
import { choice, cn } from '@/lib/utils'

// A row of radio buttons drawn as quiet words, the picked one starred: pick one of `options`. A picked option with a
// `flip` (another option's key) shows ⇅, and pressed again turns into it: `onChange` gets the flip, as a radio counts
// the press no change. Given a list as `value`, they're checkboxes, each picked one starred, and `onChange` gets the
// one flipped. An option's `icon`, a Constellation, goes before its word. `children` go at the end of the row.
export function Choices<K extends string | number>({
  legend,
  options,
  value,
  onChange,
  className,
  children,
}: {
  legend: string
  options: { key: K; label: string; flip?: K; icon?: Star[][] }[]
  value: K | K[]
  onChange: (key: K) => void
  className?: string
  children?: ReactNode
}) {
  const t = useT()
  const name = useId()
  const many = Array.isArray(value)
  return (
    <fieldset className={cn('flex flex-wrap gap-x-6 gap-y-2', className)}>
      <legend className="sr-only">{legend}</legend>
      {options.map((o, i) => {
        const picked = many ? value.includes(o.key) : o.key === value
        const flip = picked ? o.flip : undefined
        return (
          // radios are keyed by place, so one that turns into another (最新 into 最早) keeps its input, and the focus
          <label
            key={many ? o.key : i}
            // with an icon, the star moves on by half of it and its gap (18 + 6px), to stay under the word
            className={cn(choice(picked), o.icon && 'flex items-center gap-1.5 after:ml-3')}
          >
            <input
              type={many ? 'checkbox' : 'radio'}
              name={name}
              checked={picked}
              onChange={() => onChange(o.key)}
              // A press on the picked one: a pointer's (detail 1) or a screen reader's (detail 0), not a double click's
              // second, which would undo the pick its first made. Space is caught on keydown, as Chrome sends no click
              // for it on a picked radio, and kept from sending one where a browser would.
              onClick={(e) => flip !== undefined && e.detail < 2 && onChange(flip)}
              onKeyDown={(e) => {
                if (flip === undefined || e.key !== ' ' || e.repeat) return
                e.preventDefault()
                onChange(flip)
              }}
              className="sr-only"
            />
            {o.icon && <Constellation lines={o.icon} />}
            {o.label}
            {flip !== undefined && (
              <>
                {/* in the gap after the word, so the row doesn't shift and the star stays under the word */}
                <ArrowDownUp className="absolute top-1/2 left-full ml-0.5 size-3 -translate-y-1/2" />
                <span className="sr-only">{t('，再按一次倒过来', ', press again to reverse')}</span>
              </>
            )}
          </label>
        )
      })}
      {children}
    </fieldset>
  )
}
