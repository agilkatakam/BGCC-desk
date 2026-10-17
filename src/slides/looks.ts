import type { StyleId } from '../lib/types'

export const SERIF = "'Source Serif 4 Variable', Georgia, serif"
const INTER = "'Inter Variable', system-ui, sans-serif"
const ARCHIVO = "'Archivo Variable', 'Inter Variable', system-ui, sans-serif"
// 'Rupee' (index.css) is Inter's ₹ alone: DM Sans draws a stylised rupee that reads like a Z.
const DMSANS = "'Rupee', 'DM Sans Variable', 'Inter Variable', system-ui, sans-serif"

/** Typography for each of the three looks. Colours come from the palette. */
export interface Look {
  head: string
  headWeight: number
  headTrack: string
  headLead: number
  headScale: number
  body: string
  num: string
  numWeight: number
  numTrack: string
  mark: string
  markWeight: number
}

export const LOOKS: Record<StyleId, Look & { label: string; blurb: string }> = {
  editorial: {
    label: 'Editorial',
    blurb: 'Serif headlines, like a business paper',
    head: SERIF,
    headWeight: 600,
    headTrack: '-0.015em',
    headLead: 1.12,
    headScale: 1,
    body: INTER,
    num: SERIF,
    numWeight: 700,
    numTrack: '-0.03em',
    mark: SERIF,
    markWeight: 700,
  },
  bold: {
    label: 'Bold',
    blurb: 'Heavy type and big numbers that stop the scroll',
    head: ARCHIVO,
    headWeight: 800,
    headTrack: '-0.03em',
    headLead: 1.02,
    headScale: 1.06,
    body: INTER,
    num: ARCHIVO,
    numWeight: 900,
    numTrack: '-0.04em',
    mark: ARCHIVO,
    markWeight: 900,
  },
  minimal: {
    label: 'Minimal',
    blurb: 'Quiet sans-serif and lots of space',
    head: DMSANS,
    headWeight: 500,
    headTrack: '-0.03em',
    headLead: 1.1,
    headScale: 0.96,
    body: DMSANS,
    num: DMSANS,
    numWeight: 500,
    numTrack: '-0.04em',
    mark: DMSANS,
    markWeight: 700,
  },
}

