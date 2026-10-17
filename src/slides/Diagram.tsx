import { useEffect, useRef } from 'react'
import type { DiagramShape } from '../lib/types'

// AntV Infographic templates that hold up on BGCC's palettes (picked by rendering ~150 of them).
const TEMPLATES: Record<DiagramShape, string> = {
  pyramid: 'sequence-pyramid-simple',
  funnel: 'sequence-funnel-simple',
  cycle: 'sequence-circular-simple',
  roadmap: 'sequence-roadmap-vertical-simple',
  swot: 'compare-swot',
}

// Shared across slides so the library loads once, on first use.
let lib: Promise<typeof import('@antv/infographic')> | null = null
const load = () =>
  (lib ??= import('@antv/infographic').then((A) => {
    // AntV registers Chinese web fonts from its CDN and links them into the page on every render. Our slides use
    // the app's own fonts, so empty their URL lists (there's no public unregister): no remote stylesheets get
    // linked, and snapshots don't try to inline them.
    for (const f of A.getFonts()) f.fontWeight = {}
    return A
  }))

interface Props {
  shape: DiagramShape
  items: { label: string; desc?: string }[]
  ink: string
  paper: string
  accent: string
  muted: string
  font: string
}

/** A framework diagram drawn by AntV Infographic in the slide's colours. Sets data-ready when drawn, for export. */
export function Diagram({ shape, items, ink, paper, accent, muted, font }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const key = JSON.stringify({ shape, items, ink, paper, accent, font })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cancelled = false
    el.dataset.ready = ''
    void load().then((A) => {
      if (cancelled || !ref.current) return
      el.innerHTML = ''
      const family = font.split(',').map((f) => f.replace(/'/g, '').trim()).find((f) => f !== 'Rupee') ?? 'Inter Variable'
      A.setDefaultFont(family)
      const data =
        shape === 'swot'
          ? {
              compares: items.slice(0, 4).map((it) => ({
                label: it.label,
                children: (it.desc ?? '')
                  .split(/;|\n/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((label) => ({ label })),
              })),
            }
          : { items: items.slice(0, 6).map((it) => ({ label: it.label, desc: it.desc })) }
      const ig = new A.Infographic({
        container: el,
        width: el.clientWidth || 896,
        height: el.clientHeight || 700,
        template: TEMPLATES[shape],
        data,
        themeConfig: {
          colorBg: paper,
          colorPrimary: accent,
          palette: [accent, ink, muted, accent],
        },
      })
      ig.render()
      // Templates draw at a fixed size with margins; crop the SVG to what was drawn so it scales up to fill the slide.
      requestAnimationFrame(() => {
        if (cancelled) return
        const svg = el.querySelector('svg')
        if (svg) {
          try {
            // The template's full-size background rect would make the crop include all its margins; the slide
            // behind is the same colour, so drop it.
            svg.querySelector('[data-element-type="background"]')?.remove()
            const b = svg.getBBox()
            if (b.width && b.height) {
              const pad = 8
              svg.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`)
              svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
              svg.setAttribute('width', '100%')
              svg.setAttribute('height', '100%')
            }
          } catch {
            // getBBox throws if the SVG isn't laid out; keep the template's own size.
          }
        }
        el.dataset.ready = '1'
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return <div ref={ref} data-diagram style={{ width: '100%', height: '100%' }} />
}
