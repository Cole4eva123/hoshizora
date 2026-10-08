import { expect, test } from 'bun:test'
import { candidatesOf } from '@/lib/emby'

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
