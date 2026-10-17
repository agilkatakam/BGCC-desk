import { jsPDF } from 'jspdf'
import JSZip from 'jszip'
import { SLIDE_H, SLIDE_W } from './Slide'
import { snapshotter } from './snapshot'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'bgcc-post'

function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

async function renderAll(nodes: HTMLElement[]): Promise<string[]> {
  const snap = await snapshotter(nodes[0]?.parentElement?.parentElement ?? nodes[0])
  const out: string[] = []
  for (const n of nodes) {
    out.push(await snap.png(n, { width: SLIDE_W, height: SLIDE_H, pixelRatio: 1 }))
  }
  return out
}

/** Instagram: a zip of 1080×1350 PNGs. */
export async function exportPngZip(nodes: HTMLElement[], title: string) {
  const pngs = await renderAll(nodes)
  const zip = new JSZip()
  pngs.forEach((p, i) => zip.file(`${String(i + 1).padStart(2, '0')}.png`, p.split(',')[1], { base64: true }))
  download(await zip.generateAsync({ type: 'blob' }), `${slug(title)}-instagram.zip`)
}

/** LinkedIn: document posts are uploaded as a PDF with one slide per page. */
export async function exportPdf(nodes: HTMLElement[], title: string) {
  const pngs = await renderAll(nodes)
  const pdf = new jsPDF({ unit: 'px', format: [SLIDE_W, SLIDE_H], orientation: 'portrait', hotfixes: ['px_scaling'] })
  pngs.forEach((p, i) => {
    if (i > 0) pdf.addPage([SLIDE_W, SLIDE_H], 'portrait')
    pdf.addImage(p, 'PNG', 0, 0, SLIDE_W, SLIDE_H)
  })
  pdf.setProperties({ title, author: 'BITS Goa Consulting Club' })
  download(pdf.output('blob'), `${slug(title)}-linkedin.pdf`)
}

export async function exportSinglePng(node: HTMLElement, title: string, index: number) {
  const [png] = await renderAll([node])
  const blob = await (await fetch(png)).blob()
  download(blob, `${slug(title)}-${String(index + 1).padStart(2, '0')}.png`)
}
