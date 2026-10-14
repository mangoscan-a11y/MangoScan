// @vitest-environment node
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { loadConfig } from './config.ts'

const cwd = path.resolve('/tmp/webapp')

describe('loadConfig', () => {
  it('has offline-friendly defaults', () => {
    const c = loadConfig({}, cwd)
    expect(c).toMatchObject({
      mongoUri: 'mongodb://127.0.0.1:27017',
      mongoDb: 'mangoscan',
      host: '127.0.0.1',
      port: 4000,
      inferenceUrl: 'http://127.0.0.1:8765',
      serial: { kind: 'auto', baud: 921600 },
    })
    expect(c.storageDir).toBe(path.resolve(cwd, 'storage'))
  })

  it('parses an explicit port list with a per-port baud override', () => {
    const c = loadConfig({ SERIAL_PORTS: 'COM3, COM5:115200', SERIAL_BAUD: '460800' }, cwd)
    expect(c.serial).toEqual({
      kind: 'list',
      ports: [
        { path: 'COM3', baud: 460800 },
        { path: 'COM5', baud: 115200 },
      ],
    })
  })

  it('understands mock and none', () => {
    expect(loadConfig({ SERIAL_PORTS: 'mock' }, cwd).serial).toEqual({ kind: 'mock' })
    expect(loadConfig({ SERIAL_PORTS: 'none' }, cwd).serial).toEqual({ kind: 'none' })
  })

  it('accepts linux style device paths', () => {
    const c = loadConfig({ SERIAL_PORTS: '/dev/ttyUSB0' }, cwd)
    expect(c.serial).toEqual({ kind: 'list', ports: [{ path: '/dev/ttyUSB0', baud: 921600 }] })
  })

  it('resolves STORAGE_DIR relative to the working directory', () => {
    expect(loadConfig({ STORAGE_DIR: 'data/imgs' }, cwd).storageDir).toBe(path.resolve(cwd, 'data/imgs'))
  })

  it.each([
    [{ PORT: 'abc' }, /PORT/],
    [{ PORT: '70000' }, /PORT/],
    [{ SERIAL_BAUD: '12' }, /SERIAL_BAUD/],
    [{ SERIAL_PORTS: 'COM3;rm' }, /SERIAL_PORTS/],
    [{ INFERENCE_URL: 'ftp://x' }, /INFERENCE_URL/],
    [{ HOST: '' }, /HOST/],
  ])('rejects bad value %j', (env, message) => {
    expect(() => loadConfig(env, cwd)).toThrow(message)
  })
})
