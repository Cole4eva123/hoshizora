import { expect, test } from 'bun:test'
import { checked, ownOf } from './keys'

test("ownOf keeps the user's own keys of the known services, and nothing else of what's kept", () => {
  expect(ownOf('{"tmdb":"eyJhbGciOi","mdblist":"abc"}')).toEqual({ tmdb: 'eyJhbGciOi', mdblist: 'abc' })
  // a service it doesn't know, a key that isn't text or is empty
  expect(ownOf('{"tmdb":"t","trakt":"x","mdblist":5}')).toEqual({ tmdb: 't' })
  expect(ownOf('{"tmdb":""}')).toEqual({})
  // nothing kept, not JSON, or another shape
  expect(ownOf(null)).toEqual({})
  expect(ownOf('not json')).toEqual({})
  expect(ownOf('["tmdb"]')).toEqual({})
  expect(ownOf('null')).toEqual({})
})

test("checked says why a service didn't take a key: turned down, another error by its status, or not reached", async () => {
  const failed = (status?: number) =>
    Promise.reject(Object.assign(new Error(), { isAxiosError: true, response: status && { status } }))
  expect(await checked(Promise.resolve({}))).toBeUndefined()
  expect(await checked(failed(401))).toBe('rejected')
  expect(await checked(failed(403))).toBe('rejected')
  // the day's requests used up, the service down: not the key's fault
  expect(await checked(failed(429))).toBe(429)
  expect(await checked(failed())).toBe('unreachable')
})
