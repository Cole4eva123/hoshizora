import { useEffect } from 'react'
import { localeOf, useT } from '@/lib/i18n'
import { clockOf, command, usePlayer } from '@/lib/player'

// The player's page, over the video (src-tauri/src/player): a click (or Space) pauses or plays, the top moves the
// window, and the time shows at the foot.
export default function Player() {
  const t = useT()
  const s = usePlayer()
  useEffect(() => {
    document.documentElement.lang = localeOf(t) // as the main window's, for screen readers and the glyphs
  }, [t])
  if (!s) return null
  return (
    <main className="fixed inset-0 select-none">
      {/* the top moves the window, as a title bar does */}
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-7" />
      {/* focused as the window opens, so Space works at once; the whole window, so no ring around it */}
      <button
        type="button"
        autoFocus
        aria-label={s.paused ? t('播放', 'Play') : t('暂停', 'Pause')}
        onClick={() => command({ kind: 'pause', paused: !s.paused })}
        className="absolute inset-0 cursor-default outline-none"
      />
      {s.failed && (
        <p role="alert" className="pointer-events-none absolute inset-x-0 top-1/2 px-8 text-center text-body text-foreground/80">
          {t(`打不开这个片源（${s.failed}）`, `Couldn't open this source (${s.failed})`)}
        </p>
      )}
      <p className="pointer-events-none absolute bottom-4 left-5 text-name text-foreground/80 tabular-nums">
        {s.paused ? t('已暂停', 'Paused') : s.waiting ? t('正在缓冲', 'Buffering') : t('正在播放', 'Playing')}
        {s.position !== undefined && ` · ${clockOf(s.position)}`}
        {s.duration !== undefined && ` / ${clockOf(s.duration)}`}
      </p>
    </main>
  )
}
