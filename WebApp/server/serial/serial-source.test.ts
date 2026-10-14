// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { autoBaud, looksLikeEspAdapter } from './serial-source.ts'

describe('autoBaud', () => {
  const mode = { baud: 921600, adapterBauds: { '10c4': 115200 } }

  it('uses the adapter override, whatever the case of the vendor id', () => {
    expect(autoBaud({ vendorId: '10C4' }, mode)).toBe(115200)
    expect(autoBaud({ vendorId: '10c4' }, mode)).toBe(115200)
  })

  it('falls back to the default for other adapters and for ports with no ids', () => {
    expect(autoBaud({ vendorId: '1a86' }, mode)).toBe(921600)
    expect(autoBaud({}, mode)).toBe(921600)
  })
})

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
