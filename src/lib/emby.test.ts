import { expect, test } from 'bun:test'
import { candidatesOf, itemsOf, librariesOf, lineupOfItems } from '@/lib/emby'

test("candidatesOf tries https before http, on the port typed or else Emby's and the default", () => {
  expect(candidatesOf('192.168.1.5')).toEqual([
    'https://192.168.1.5/emby',
    'https://192.168.1.5:8920/emby',
    'http://192.168.1.5:8096/emby',
    'http://192.168.1.5/emby',
  ])
  expect(candidatesOf(' nas.local:8920 ')).toEqual(['https://nas.local:8920/emby', 'http://nas.local:8920/emby'])
  expect(candidatesOf('nas.local:80')).toEqual(['https://nas.local:80/emby', 'http://nas.local/emby'])
  expect(candidatesOf('nas.local:9000/#')).toEqual(['https://nas.local:9000/emby', 'http://nas.local:9000/emby'])
  expect(candidatesOf('nas.local:9000?x')).toEqual(['https://nas.local:9000/emby', 'http://nas.local:9000/emby'])
  // a colon further on is no port
  expect(candidatesOf('nas.local/web/index.html?t=12:30')).toHaveLength(4)
})

test('candidatesOf keeps a typed scheme, port and path, under one /emby', () => {
  expect(candidatesOf('https://emby.example.com/')).toEqual(['https://emby.example.com/emby'])
  expect(candidatesOf('HTTPS://Emby.Example.com/emby/')).toEqual(['https://emby.example.com/emby'])
  expect(candidatesOf('http://example.com:8080/media')).toEqual(['http://example.com:8080/media/emby'])
})

test("candidatesOf takes the web client's address, as copied from the browser", () => {
  expect(candidatesOf('http://192.168.1.5:8096/web/index.html')).toEqual(['http://192.168.1.5:8096/emby'])
  expect(candidatesOf('https://example.com/emby/web/')).toEqual(['https://example.com/emby'])
})

test('candidatesOf turns down what is not an address', () => {
  expect(() => candidatesOf('not an address')).toThrow()
})

const nas = { address: 'https://nas.local/emby' }

test("librariesOf keeps the 媒体库 of movies and series, in the server's order, with their covers", () => {
  const views = [
    { Id: '3', Name: '剧集', CollectionType: 'tvshows', ImageTags: { Primary: 'b' } },
    { Id: '9', Name: '音乐', CollectionType: 'music', ImageTags: { Primary: 'c' } },
    { Id: '1', Name: '电影', CollectionType: 'movies' },
    { Id: '5', Name: '合集', CollectionType: 'boxsets' },
    { Id: '7', Name: '混合' },
  ]
  expect(librariesOf(nas, views)).toEqual([
    { id: '3', name: '剧集', cover: 'https://nas.local/emby/Items/3/Images/Primary?tag=b&maxWidth=480&quality=90' },
    { id: '1', name: '电影', cover: undefined },
    { id: '7', name: '混合', cover: undefined },
  ])
})

test('itemsOf links a 作品 to its TMDB entry when the server knows it, and keeps each once', () => {
  const sanguo = { Id: 'a', Name: '三国', Type: 'Series', ProductionYear: 2010, ImageTags: { Primary: 't' }, ProviderIds: { Tmdb: '40052' } }
  // the last of a page, pushed onto the next by one added meanwhile
  const listed = [sanguo, { Id: 'b', Name: '戒灵', Type: 'Movie', ProviderIds: { Imdb: 'tt1' } }, sanguo]
  expect(itemsOf(nas, listed)).toEqual([
    {
      id: 'a',
      name: '三国',
      year: 2010,
      poster: 'https://nas.local/emby/Items/a/Images/Primary?tag=t&maxWidth=342&quality=90',
      tmdb: { media_type: 'tv', id: 40052 },
    },
    { id: 'b', name: '戒灵', year: undefined, poster: undefined, tmdb: undefined },
  ])
})

test('lineupOfItems steps through the 作品 with a TMDB entry, each once however many copies the server keeps', () => {
  const copy = (id: string, tmdb?: number) => ({ id, name: id, tmdb: tmdb ? { media_type: 'movie' as const, id: tmdb } : undefined })
  expect(lineupOfItems([copy('A', 1), copy('X 4K', 2), copy('none'), copy('X', 2), copy('B', 3)])).toEqual([
    { media_type: 'movie', id: 1, title: 'A' },
    { media_type: 'movie', id: 2, title: 'X' },
    { media_type: 'movie', id: 3, title: 'B' },
  ])
})
