import { afterEach, describe, expect, it, vi } from 'vitest'
import { armAudioUnlock, isMuted, setMuted } from '@/features/bins/bin-sound'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('armAudioUnlock', () => {
  it('creates and resumes the audio context on the first user gesture, only once', () => {
    const resume = vi.fn()
    const created = vi.fn()
    class FakeAudioContext {
      state = 'suspended'
      constructor() {
        created()
      }
      resume = resume
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

    armAudioUnlock()
    expect(created).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('pointerdown'))
    window.dispatchEvent(new Event('keydown'))
    window.dispatchEvent(new Event('pointerdown'))

    expect(created).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalled()
  })

  it('does nothing and does not throw where audio is unsupported', () => {
    vi.stubGlobal('AudioContext', undefined)
    armAudioUnlock()
    expect(() => window.dispatchEvent(new Event('pointerdown'))).not.toThrow()
  })
})

describe('mute preference', () => {
  it('is off by default and remembers the choice', () => {
    expect(isMuted()).toBe(false)
    setMuted(true)
    expect(isMuted()).toBe(true)
    setMuted(false)
    expect(isMuted()).toBe(false)
  })

  it('survives storage being unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(isMuted()).toBe(false)
    expect(() => setMuted(true)).not.toThrow()
  })
})
