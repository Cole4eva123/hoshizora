import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'
import type { EmbyError } from '@/lib/emby'

// The player plays in a window of its own (src-tauri/src/player), its page player.html over the video. This is what
// the two windows say to it: the 作品 page's 播放 opens a version there, and the player's page tells it what to do and
// hears how playing goes.

// How playing goes, sent whole on each change (the Rust side's player::State): the 作品 as its page named it, where it's
// at and how long it is (seconds, once the file says), whether it waits (opening, seeking, or the network behind), is
// paused, has ended (on its last frame), or failed, why in mpv's words.
export type PlayerState = {
  title: string
  position?: number
  duration?: number
  paused: boolean
  waiting: boolean
  ended: boolean
  failed?: string
}

// What the player's page asks of the player.
export type Command = { kind: 'pause'; paused: boolean }
export const command = (command: Command) => invoke('player_command', { command })

// How playing goes, as the player's page draws it: asked once as it opens, then each change as it's heard; one heard
// before the answer is newer than it.
export function usePlayer() {
  const [state, setState] = useState<PlayerState>()
  useEffect(() => {
    let live = true
    const unlisten = listen<PlayerState>('player://state', (e) => setState(e.payload))
    invoke<PlayerState>('player_state').then((s) => live && setState((heard) => heard ?? s))
    return () => {
      live = false
      unlisten.then((stop) => stop())
    }
  }, [])
  return state
}

// Why a version couldn't be opened: what Emby said, or `player` when the player itself couldn't start.
export type PlayError = EmbyError | { kind: 'player' }

// Plays a version of a 作品 (a movie, an episode) in the player's window, from where the user left off, named `title`
// there.
export const playVersion = (p: { server: string; user: string; item: string; version: string; title: string }) =>
  invoke('player_open', p)

// A time in seconds as a player shows it: 1:02:03, or 2:03 under an hour.
export function clockOf(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
  const two = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`
}
