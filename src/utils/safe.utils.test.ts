import { assertEquals, assertInstanceOf } from '@std/assert'
import { describe, it } from 'node:test'
import { safe, safeAsync } from './safe.utils.ts'

describe('All Safe Utils Tests', () => {
  describe('safe', () => {
    it('carries what the callback returned, with no error beside it', () => {
      // Act
      const { data, error } = safe(() => 42)

      // Assert
      assertEquals(data, 42)
      assertEquals(error, null)
    })

    it('carries what the callback threw, with no data beside it', () => {
      // Act
      const { data, error } = safe(() => {
        throw new Error('refused')
      })

      // Assert
      assertEquals(data, null)
      assertEquals(error?.message, 'refused')
    })

    // A throw is not required to be an Error, and a caller reading error.message needs one that is.
    it('wraps a thrown value that is not an Error, since a caller reads its message', () => {
      // Act
      const { error } = safe(() => {
        throw 'a bare string'
      })

      // Assert
      assertInstanceOf(error, Error)
      assertEquals(error.message, 'a bare string')
    })

    // A falsy return is still a return, and treating it as failure would refuse a legitimate value.
    it('reads a falsy return as data rather than as failure', () => {
      // Act & Assert
      assertEquals(safe(() => 0).error, null)
      assertEquals(safe(() => '').error, null)
      assertEquals(safe(() => null).data, null)
    })
  })

  describe('safeAsync', () => {
    it('carries what the promise resolved to, with no error beside it', async () => {
      // Act
      const { data, error } = await safeAsync(() => Promise.resolve('ok'))

      // Assert
      assertEquals(data, 'ok')
      assertEquals(error, null)
    })

    it('carries what the promise rejected with, with no data beside it', async () => {
      // Act
      const { data, error } = await safeAsync(() => Promise.reject(new Error('refused')))

      // Assert
      assertEquals(data, null)
      assertEquals(error?.message, 'refused')
    })

    // A rejection need not be an Error either, and the same caller reads the same message.
    it('wraps a rejection that is not an Error', async () => {
      // Act
      const { error } = await safeAsync(() => Promise.reject('a bare string'))

      // Assert
      assertInstanceOf(error, Error)
      assertEquals(error.message, 'a bare string')
    })

    // A callback throwing before it returns a promise fails the same way one rejecting does.
    it('catches a throw from the callback as well as a rejection from its promise', async () => {
      // Act
      const { error } = await safeAsync(() => {
        throw new Error('threw before returning')
      })

      // Assert
      assertEquals(error?.message, 'threw before returning')
    })
  })
})
