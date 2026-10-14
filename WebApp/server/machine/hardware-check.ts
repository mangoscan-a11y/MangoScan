import type { DeviceManager } from '../serial/device-manager.ts'

/** Photos taken only to look at the camera carry this id. Real scans start at 1. */
const PREVIEW_SCAN_ID = 0

export type SensorState = 'ok' | 'no_echo' | 'absent'

export interface SensorReading {
  bin: number
  /** ok: the sensor measured a distance. no_echo: it is installed but heard nothing. absent: no sensor for this bin. */
  state: SensorState
  cm: number | null
}

export class CheckError extends Error {
  readonly code: 'NO_CAMERA' | 'NO_CONTROLLER' | 'FAILED'

  constructor(code: 'NO_CAMERA' | 'NO_CONTROLLER' | 'FAILED', message: string) {
    super(message)
    this.name = 'CheckError'
    this.code = code
  }
}

export interface HardwareCheckDeps {
  devices: DeviceManager
  /** The scan queue. A photo taken here waits for any scan in progress instead of talking over it. */
  queue: { exclusive<T>(job: () => Promise<T>): Promise<T> }
  captureTimeoutMs?: number
  distTimeoutMs?: number
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Looks at the real hardware on request: one photo from a camera, one reading
 * from every bin sensor. Nothing is stored and no servo moves.
 */
export class HardwareCheck {
  private readonly d: HardwareCheckDeps
  private readonly captureTimeoutMs: number
  private readonly distTimeoutMs: number

  constructor(deps: HardwareCheckDeps) {
    this.d = deps
    this.captureTimeoutMs = deps.captureTimeoutMs ?? 2000
    this.distTimeoutMs = deps.distTimeoutMs ?? 1500
  }

  async preview(cameraId: string): Promise<Buffer> {
    const cam = this.d.devices.cameras().find((c) => c.info.id === cameraId)
    if (!cam) throw new CheckError('NO_CAMERA', 'That camera is not connected')
    const angle = cam.info.angles.find((a) => Number.isInteger(a) && a >= 1 && a <= 9) ?? 1
    return this.d.queue.exclusive(async () => {
      try {
        return await cam.capture(PREVIEW_SCAN_ID, angle, this.captureTimeoutMs)
      } catch (err) {
        throw new CheckError('FAILED', 'The camera did not deliver a photo: ' + errText(err))
      }
    })
  }

  async sensors(): Promise<SensorReading[]> {
    const controller = this.d.devices.controller()
    if (!controller) throw new CheckError('NO_CONTROLLER', 'The controller is not connected')
    if (!controller.info.caps.includes('bins')) throw new CheckError('NO_CONTROLLER', 'The controller has no bin sensors')
    let cm: (number | null)[]
    try {
      cm = await controller.distances(this.distTimeoutMs)
    } catch (err) {
      throw new CheckError(
        'FAILED',
        'The controller did not report distances (it needs firmware 1.1 or newer): ' + errText(err),
      )
    }
    return cm.map((value, i) => {
      const bin = i + 1
      if (value === null) return { bin, state: 'absent', cm: null }
      if (value < 0) return { bin, state: 'no_echo', cm: null }
      return { bin, state: 'ok', cm: value }
    })
  }
}
