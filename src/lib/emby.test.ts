import { expect, test } from 'bun:test'
import { baseOf } from '@/lib/emby'

test('baseOf fills in what a home server address leaves out', () => {
  expect(baseOf('192.168.1.5')).toBe('http://192.168.1.5:8096/emby')
  expect(baseOf(' nas.local:8920 ')).toBe('http://nas.local:8920/emby')
  expect(baseOf('nas.local:80')).toBe('http://nas.local/emby')
})

test('baseOf keeps a typed scheme, port and path, under one /emby', () => {
  expect(baseOf('https://emby.example.com/')).toBe('https://emby.example.com/emby')
  expect(baseOf('HTTPS://Emby.Example.com/emby/')).toBe('https://emby.example.com/emby')
  expect(baseOf('http://example.com:8080/media')).toBe('http://example.com:8080/media/emby')
})

test("baseOf takes the web client's address, as copied from the browser", () => {
  expect(baseOf('http://192.168.1.5:8096/web/index.html')).toBe('http://192.168.1.5:8096/emby')
  expect(baseOf('https://example.com/emby/web/')).toBe('https://example.com/emby')
})

test('baseOf turns down what is not an address', () => {
  expect(() => baseOf('not an address')).toThrow()
})
