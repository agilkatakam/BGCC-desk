import { getFontEmbedCSS, toJpeg, toPng } from 'html-to-image'

/**
 * Snapshots slides with the page's fonts embedded once for the whole set, not re-fetched per slide.
 * `root` should contain every slide so all the fonts they use are collected.
 */
export async function snapshotter(root: HTMLElement) {
  await document.fonts.ready
  let fontEmbedCSS = ''
  try {
    fontEmbedCSS = await getFontEmbedCSS(root)
  } catch {
    // Fonts fall back to the system's if embedding fails; the snapshot still renders.
  }
  const opts = { fontEmbedCSS, cacheBust: false }
  return {
    png: (n: HTMLElement, o: { width?: number; height?: number; pixelRatio?: number } = {}) => toPng(n, { ...opts, ...o }),
    jpeg: (n: HTMLElement, o: { pixelRatio?: number; quality?: number } = {}) => toJpeg(n, { ...opts, ...o }),
  }
}
