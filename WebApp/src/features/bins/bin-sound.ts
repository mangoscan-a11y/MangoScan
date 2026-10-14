const KEY = 'mangoscan-bin-sound'

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === 'off'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(KEY, muted ? 'off' : 'on')
  } catch {
    // storage unavailable, the preference just will not persist
  }
}

let context: AudioContext | null = null

/**
 * Browsers refuse to play sound until the page has had a click or keypress. Arm a one-time
 * unlock so the very first interaction readies the audio, and a later bin-full beep is audible.
 */
export function armAudioUnlock(): void {
  const unlock = () => {
    try {
      const Ctx = window.AudioContext
      if (!Ctx) return
      context ??= new Ctx()
      void context.resume()
    } catch {
      // audio is a convenience; the banner and toast still show
    }
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/** Three short rising beeps. Generated in the browser, so it works offline. */
export function playAlertBeep(): void {
  try {
    const Ctx = window.AudioContext
    if (!Ctx) return
    context ??= new Ctx()
    if (context.state === 'suspended') void context.resume()
    const start = context.currentTime
    for (let i = 0; i < 3; i++) {
      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.type = 'sine'
      osc.frequency.value = 660 + i * 110
      const t = start + i * 0.22
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      osc.connect(gain).connect(context.destination)
      osc.start(t)
      osc.stop(t + 0.2)
    }
  } catch {
    // audio is a convenience; the banner and toast still show
  }
}

/** Desktop notification for when this window is in the background. */
export function notifyDesktop(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (document.hasFocus()) return
    new Notification(title, { body, tag: 'mangoscan-bin' })
  } catch {
    // not supported in this browser
  }
}

export async function requestDesktopPermission(): Promise<void> {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  } catch {
    // not supported in this browser
  }
}
