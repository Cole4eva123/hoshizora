import type { Status } from '@/lib/emby'
import { cn, server, toneOf } from '@/lib/utils'

export type Star = [x: number, y: number, r?: number]

// A small icon drawn like the logo: stars on a 24-unit grid, joined by faint lines. Each line runs through its stars in
// order (a line of one is a star on its own), and a closed shape comes back to its first; an `r` makes a star bigger,
// as a slider's knob. It takes the colour of the words beside it, so it lights up with them. Choices counts on its 18px
// to keep the picked star under the word; drawn larger, it takes a `className` size.
export function Constellation({ lines, className }: { lines: Star[][]; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn('size-4.5 shrink-0', className)}>
      {lines
        .filter((stars) => stars.length > 1)
        .map((stars, i) => (
          <polyline
            key={i}
            points={stars.map(([x, y]) => `${x},${y}`).join(' ')}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.6}
            strokeWidth={1.25}
          />
        ))}
      {/* a star listed twice is drawn once, as first listed: the words' see-through colour, laid twice, is brighter */}
      {lines
        .flat()
        .filter(([x, y], i, all) => all.findIndex(([a, b]) => a === x && b === y) === i)
        .map(([x, y, r = 1.7], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill="currentColor" />
        ))}
    </svg>
  )
}

// A 服务器: the `server` constellation, its star the light, in the server's tone; it glows once there's an answer. On
// its tile on the 媒体库 page, and by its name on its own page. Sized by `className`.
export function ServerMark({ status, className }: { status: Status; className: string }) {
  return (
    // a span, as it also goes in a heading
    <span className={cn('relative block shrink-0 text-star/70', toneOf(status), className)}>
      <Constellation lines={server} className="size-full" />
      {/* over the icon's light, at (7, 12) of its 24 */}
      <span
        className={cn(
          'absolute top-1/2 left-[29.17%] size-1/6 -translate-1/2 rounded-full bg-tone shadow-[0_0_8px_2px_var(--tone)] transition duration-500',
          status === 'checking' && 'shadow-none',
        )}
      />
    </span>
  )
}
