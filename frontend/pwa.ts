// Installable Workspace (client revision 5): what the home-screen app looks like. Read by nuxt.config.ts
// (head tags) and scripts/generate-pwa-assets.mjs (icons and iOS launch screens in public/).

/** Surfaces of the Workspace, from the brand kit and themes.css (Violet Workspace, the default). */
export const PWA_COLORS = {
  background: '#F7F6FA', // brand Paper: launch screen and manifest background
  backgroundDark: '#16131F', // brand Ink
  bar: '#ffffff', // navbar surface (--ui-bg), so the status bar blends with the page
  barDark: '#16141e'
}

/** iOS shows a launch screen only when one matches the device exactly (CSS size and pixel ratio).
 *  Portrait for phones; both orientations for iPads. */
export const SPLASH_DEVICES: { width: number, height: number, ratio: number, landscape?: boolean }[] = [
  { width: 440, height: 956, ratio: 3 }, // iPhone 16 Pro Max
  { width: 402, height: 874, ratio: 3 }, // iPhone 16 Pro
  { width: 430, height: 932, ratio: 3 }, // iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 393, height: 852, ratio: 3 }, // iPhone 14 Pro, 15, 15 Pro, 16
  { width: 428, height: 926, ratio: 3 }, // iPhone 12/13 Pro Max, 14 Plus
  { width: 390, height: 844, ratio: 3 }, // iPhone 12, 13, 14
  { width: 375, height: 812, ratio: 3 }, // iPhone X, XS, 11 Pro, 12/13 mini
  { width: 414, height: 896, ratio: 3 }, // iPhone XS Max, 11 Pro Max
  { width: 414, height: 896, ratio: 2 }, // iPhone XR, 11
  { width: 414, height: 736, ratio: 3 }, // iPhone 6–8 Plus
  { width: 375, height: 667, ratio: 2 }, // iPhone 6–8, SE (2nd, 3rd generation)
  { width: 1024, height: 1366, ratio: 2, landscape: true }, // iPad Pro 12.9"
  { width: 834, height: 1194, ratio: 2, landscape: true }, // iPad Pro 11", iPad Air 13"
  { width: 820, height: 1180, ratio: 2, landscape: true }, // iPad Air (4th, 5th generation), iPad (10th)
  { width: 810, height: 1080, ratio: 2, landscape: true }, // iPad (7th–9th generation)
  { width: 768, height: 1024, ratio: 2, landscape: true }, // iPad mini (5th), iPad Air (3rd)
  { width: 744, height: 1133, ratio: 2, landscape: true } // iPad mini (6th generation)
]

export interface SplashImage { file: string, media: string, width: number, height: number, ratio: number, dark: boolean }

export function splashImages(): SplashImage[] {
  return SPLASH_DEVICES.flatMap(({ width, height, ratio, landscape }) =>
    (landscape ? ['portrait', 'landscape'] : ['portrait']).flatMap((orientation) => {
      const [w, h] = orientation === 'portrait' ? [width, height] : [height, width]
      return [false, true].map(dark => ({
        file: `splash/${w * ratio}x${h * ratio}${dark ? '-dark' : ''}.png`,
        media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation}) and (prefers-color-scheme: ${dark ? 'dark' : 'light'})`,
        width: w,
        height: h,
        ratio,
        dark
      }))
    })
  )
}
