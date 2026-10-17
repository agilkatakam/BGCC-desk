import type { ReactNode } from 'react'
import { PALETTES, brandFor } from '../lib/brand'
import { useStore } from '../lib/store'
import type { IdeaCard } from '../lib/types'
import { SLIDE_H, SLIDE_W, Slide } from '../slides/Slide'
import { slideSource } from '../lib/factcheck'

export function Scaled({ scale, children }: { scale: number; children: ReactNode }) {
  return (
    <div style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }} className="relative shrink-0 overflow-hidden">
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SLIDE_W, height: SLIDE_H }}>{children}</div>
    </div>
  )
}

export function CardSlide({ card, index, scale }: { card: IdeaCard; index: number; scale: number }) {
  const brand = useStore((s) => s.brand)
  return (
    <Scaled scale={scale}>
      <Slide slide={card.slides[index]} index={index} total={card.slides.length} brand={brandFor(brand, card)} style={card.style} source={slideSource(card, index)} />
    </Scaled>
  )
}

const TINTS = ['#eef3fb', '#f4f1fb', '#fdf8ec', '#eef7f0', '#fbefea', '#f3f4f6']

/** The little tilted slide on a tile: the real cover once built, a sketch of one before. */
export function Thumb({ card, tint = 0 }: { card: IdeaCard; tint?: number }) {
  const pal = PALETTES[card.palette ?? 'bgcc'].palette
  return (
    <div className="relative grid h-[100px] w-[108px] shrink-0 place-items-center overflow-hidden rounded-[10px]" style={{ background: TINTS[tint % TINTS.length] }}>
      <div className="overflow-hidden rounded-[4px] shadow-[0_6px_14px_-6px_#0003] transition-transform duration-200 group-hover:-translate-y-[3px] group-hover:-rotate-[1.5deg]">
        {card.status === 'built' && card.slides.length ? (
          <CardSlide card={card} index={0} scale={62 / SLIDE_W} />
        ) : (
          <div className="flex h-[78px] w-[62px] flex-col p-[7px] font-serif text-[7.5px] leading-[1.12] font-bold" style={{ background: pal.ink, color: pal.paper }}>
            <small className="font-sans text-[4px] font-semibold tracking-[0.1em] opacity-70">BGCC</small>
            <i className="mt-auto mb-1 block h-[1.5px] w-2.5" style={{ background: pal.accent }} />
            <span className="line-clamp-4">{card.hook || card.title}</span>
          </div>
        )}
      </div>
    </div>
  )
}
