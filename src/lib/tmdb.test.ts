import { expect, test } from 'bun:test'
import { type Details, type Episode, daysUntil, nextEpisodeText } from './tmdb'

const now = new Date('2026-10-02T21:30')
const ep = (season_number: number, episode_number: number, air_date: string | null) =>
  ({ season_number, episode_number, air_date }) as Episode
const show = (fields: Partial<Details>) => ({ status: 'Returning Series', number_of_seasons: 1, ...fields }) as Details

test('next episode: season shown only when there are several, countdown in days', () => {
  // late evening still counts as today, and the DST change on Nov 1 doesn't shift the count
  expect(daysUntil('2026-10-02', now)).toBe(0)
  expect(daysUntil('2026-11-03', now)).toBe(32)

  const svu = show({ number_of_seasons: 28, next_episode_to_air: ep(28, 1, '2026-10-08') })
  expect(nextEpisodeText(svu, now)).toContain('下一集：第 28 季第 1 集，')
  expect(nextEpisodeText(svu, now)).toEndWith('播出（6天后）')
  expect(nextEpisodeText(show({ next_episode_to_air: ep(1, 40, '2026-10-02') }), now)).toEndWith('（今天）')
  expect(nextEpisodeText(show({ next_episode_to_air: ep(1, 9, null) }), now)).toBe('下一集：第 9 集，播出时间还没公布')

  expect(nextEpisodeText(show({ status: 'Ended', number_of_episodes: 8 }), now)).toBe('已完结，共 8 集')
  expect(nextEpisodeText(show({ status: 'Canceled', number_of_seasons: 3, number_of_episodes: 30 }), now)).toBe(
    '已停播，共 3 季 30 集',
  )
  expect(nextEpisodeText(show({}), now)).toBe('下一集的播出时间还没公布')
})
