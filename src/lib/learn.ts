import { generate } from './gemini'
import { getState } from './store'
import type { BrandProfile } from './types'

const str = { type: 'string' }
const arr = { type: 'array', items: str }
const PROFILE_SCHEMA = {
  type: 'object',
  properties: { voice: arr, dos: arr, donts: arr, hookPatterns: arr, hashtags: arr, audience: arr, exemplars: arr, summary: str },
  required: ['voice', 'dos', 'donts', 'hookPatterns', 'hashtags', 'audience', 'exemplars', 'summary'],
}

export interface ImageInput {
  mime: string
  data: string // base64, no data: prefix
}

/** Updates BGCC's voice profile from pasted captions and/or screenshots of real posts. */
export async function learnBrand(captions: string, images: ImageInput[]): Promise<{ brand: BrandProfile; summary: string }> {
  const { brand, setBrand } = getState()
  let visual = ''
  if (images.length) {
    const v = await generate({
      role: 'vision',
      temperature: 0.2,
      contents: [
        {
          role: 'user',
          parts: [
            ...images.slice(0, 12).map((u) => ({ inlineData: { mimeType: u.mime, data: u.data } })),
            {
              text: 'These are screenshots of past social posts by a student consulting club. For each, transcribe the headline or hook text and any caption, then describe the tone, content type (primer, guesstimate, case, event, recruitment, etc.), layout, colours and typography. Finish with the patterns common to all of them.',
            },
          ],
        },
      ],
    })
    visual = v.text
  }
  if (!captions.trim() && !visual) throw new Error('Paste some captions or add post screenshots first.')
  const r = await generate({
    role: 'writer',
    schema: PROFILE_SCHEMA,
    temperature: 0.4,
    prompt: `Update the brand voice profile for ${brand.name} from evidence of its real posts. Keep what the evidence supports, change what it contradicts, and add what is missing. Each list item is one concise, specific, behavioural sentence (4–7 items per list). "exemplars" must be verbatim captions or hooks copied from the evidence (up to 5); keep the existing ones only if no new ones are given.

CURRENT PROFILE:
${JSON.stringify({ voice: brand.voice, dos: brand.dos, donts: brand.donts, hookPatterns: brand.hookPatterns, hashtags: brand.hashtags, audience: brand.audience, exemplars: brand.exemplars }, null, 1)}

PAST CAPTIONS:
${captions.trim() || '(none provided)'}

NOTES FROM POST SCREENSHOTS:
${visual || '(none provided)'}

Also give a 2-sentence "summary" of what changed.`,
  })
  const j = r.json
  if (!j?.voice) throw new Error('Could not read a profile from that. Try again.')
  const next: BrandProfile = {
    ...brand,
    voice: j.voice,
    dos: j.dos,
    donts: j.donts,
    hookPatterns: j.hookPatterns,
    hashtags: j.hashtags.map((h: string) => (h.startsWith('#') ? h : `#${h}`)),
    audience: j.audience,
    exemplars: j.exemplars?.length ? j.exemplars : brand.exemplars,
    updatedAt: new Date().toISOString().slice(0, 10),
  }
  setBrand(next)
  return { brand: next, summary: j.summary }
}
