import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HardwareCheckDialog } from '@/features/machine/HardwareCheckDialog'
import type { DeviceStatus, SensorReading } from '@/lib/database.types'

const device = (over: Partial<DeviceStatus>): DeviceStatus => ({
  id: 'x',
  port: 'COM9',
  caps: [],
  angles: [],
  fw: '1.1',
  connected: true,
  connected_at: null,
  last_seen: null,
  ...over,
})
const camera = device({ id: 'cam-1', port: 'COM4', caps: ['camera'], angles: [1] })
const controller = device({ id: 'ctrl-1', port: 'COM3', caps: ['servo', 'bins'] })

const sensors = (bin1: Partial<SensorReading>): SensorReading[] =>
  Array.from({ length: 8 }, (_, i) => ({ bin: i + 1, state: 'absent' as const, cm: null, ...(i === 0 ? bin1 : {}) }))

function stubServer(opts: { bin1: Partial<SensorReading>; photo?: 'ok' | 'fail' }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('/api/machine/preview/')) {
      if (opts.photo === 'fail') return new Response(JSON.stringify({ error: 'The camera did not deliver a photo' }), { status: 502 })
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 })
    }
    return new Response(JSON.stringify({ sensors: sensors(opts.bin1) }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function open(devices: DeviceStatus[]) {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <HardwareCheckDialog devices={devices} />
    </QueryClientProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /check hardware/i }))
}

// jsdom has no object URLs.
const urlApi = URL as unknown as Record<string, unknown>
beforeEach(() => {
  urlApi.createObjectURL = vi.fn(() => 'blob:photo')
  urlApi.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete urlApi.createObjectURL
  delete urlApi.revokeObjectURL
})

describe('HardwareCheckDialog', () => {
  it('shows a photo and a working sensor as soon as it opens', async () => {
    const fetchMock = stubServer({ bin1: { state: 'ok', cm: 23 } })
    open([camera, controller])

    expect(await screen.findByAltText('Photo from cam-1')).toBeInTheDocument()
    expect(await screen.findByText('23 cm')).toBeInTheDocument()
    expect(screen.getByText('Working', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('Bins 2-8 have no sensor installed.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/machine/preview/cam-1')).toBe(true)
  })

  it('says so when a sensor hears no echo', async () => {
    stubServer({ bin1: { state: 'no_echo' } })
    open([camera, controller])
    expect(await screen.findByText('No echo')).toBeInTheDocument()
  })

  it('shows the camera error instead of a photo', async () => {
    stubServer({ bin1: { state: 'ok', cm: 20 }, photo: 'fail' })
    open([camera, controller])
    expect(await screen.findByText('The camera did not deliver a photo')).toBeInTheDocument()
    expect(screen.getByText('No photo')).toBeInTheDocument()
  })

  it('takes another photo on request', async () => {
    const fetchMock = stubServer({ bin1: { state: 'ok', cm: 20 } })
    open([camera, controller])
    await screen.findByAltText('Photo from cam-1')
    const photos = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/machine/preview/')).length
    const before = photos()
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }))
    await waitFor(() => expect(photos()).toBe(before + 1))
  })

  it('explains what is missing when nothing is connected', () => {
    stubServer({ bin1: {} })
    open([])
    expect(screen.getByText('No camera is connected.')).toBeInTheDocument()
    expect(screen.getByText(/controller is not connected/i)).toBeInTheDocument()
  })

  it('does not ask for anything before it is opened', () => {
    const fetchMock = stubServer({ bin1: {} })
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <HardwareCheckDialog devices={[camera, controller]} />
      </QueryClientProvider>,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
