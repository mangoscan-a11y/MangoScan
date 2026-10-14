// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { looksLikeEspAdapter } from './serial-source.ts'

describe('looksLikeEspAdapter', () => {
  it.each([
    ['CP210x', { vendorId: '10C4', productId: 'EA60' }],
    ['CH340', { vendorId: '1a86', productId: '7523' }],
    ['FTDI', { vendorId: '0403', productId: '6001' }],
    ['Espressif native USB', { vendorId: '303A', productId: '1001' }],
  ])('accepts %s', (_name, info) => {
    expect(looksLikeEspAdapter(info)).toBe(true)
  })

  it.each([
    ['a bluetooth modem port', { vendorId: '8087' }],
    ['a port with no ids', {}],
    ['garbage', { vendorId: 'not-hex' }],
  ])('rejects %s', (_name, info) => {
    expect(looksLikeEspAdapter(info)).toBe(false)
  })
})
