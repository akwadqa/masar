import { describe, expect, it } from 'vitest'
import { formatAge } from '../../app/utils/format'
import { splashImages, SPLASH_DEVICES } from '../../pwa'

describe('client revision 5', () => {
  it('formats notification ages', () => {
    const now = new Date('2026-10-29T12:00:00+03:00')
    expect(formatAge('2026-10-29T11:59:30+03:00', now)).toBe('now')
    expect(formatAge('2026-10-29T11:55:00+03:00', now)).toBe('5m')
    expect(formatAge('2026-10-29T09:00:00+03:00', now)).toBe('3h')
    expect(formatAge('2026-10-27T12:00:00+03:00', now)).toBe('2d')
    expect(formatAge('2026-10-01T12:00:00+03:00', now)).toBe('1 Oct')
  })

  it('has a light and a dark launch screen for every device and orientation', () => {
    const images = splashImages()
    const orientations = SPLASH_DEVICES.reduce((sum, device) => sum + (device.landscape ? 2 : 1), 0)
    expect(images).toHaveLength(orientations * 2)
    expect(new Set(images.map(image => image.file)).size).toBe(images.length)
    const pro = images.find(image => image.file === 'splash/1179x2556.png')
    expect(pro?.media).toContain('(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)')
    expect(pro?.media).toContain('prefers-color-scheme: light')
  })
})
