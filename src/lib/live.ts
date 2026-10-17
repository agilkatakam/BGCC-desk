import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai'
import { TOOL_DECLS, deskSystemPrompt, runTool } from './agent'
import { candidatesFor, getApiKey } from './gemini'
import type { ChatPart, SourceRef } from './types'

// Converts mic audio to 16 kHz mono 16-bit PCM in ~100 ms chunks.
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1600); this.n = 0 }
  process(inputs) {
    const ch = inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0).buffer); this.n = 0 }
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

const toBase64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromBase64 = (b64: string) => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

export interface LiveEvents {
  onStatus: (s: 'connecting' | 'live' | 'closed' | 'error', detail?: string) => void
  onTranscript: (who: 'you' | 'desk', text: string, final: boolean) => void
  /** Cards, research and slides the desk produces while talking; shown in the chat behind the voice panel. */
  onPart: (part: ChatPart) => void
  onPartsChanged: () => void
  onLevel: (input: number, output: number) => void
}

export class LiveDesk {
  private session?: Session
  private micCtx?: AudioContext
  private outCtx?: AudioContext
  private stream?: MediaStream
  private inAnalyser?: AnalyserNode
  private outAnalyser?: AnalyserNode
  private playAt = 0
  private playing = new Set<AudioBufferSourceNode>()
  private raf = 0
  private muted = false
  model = ''
  private ev: LiveEvents

  constructor(ev: LiveEvents) {
    this.ev = ev
  }

  private registry: SourceRef[] = []

  async start(registry: SourceRef[], voice = 'Kore') {
    this.registry = registry
    this.ev.onStatus('connecting')
    const [model] = await candidatesFor('live')
    this.model = model
    const ai = new GoogleGenAI({ apiKey: getApiKey() })

    this.outCtx = new AudioContext({ sampleRate: 24000 })
    this.outAnalyser = this.outCtx.createAnalyser()
    this.outAnalyser.connect(this.outCtx.destination)

    const system = `${deskSystemPrompt('voice')}
Before building a post, ask out loud which format and colour scheme they want (BGCC black is the club's own look), then call build_post.
Start by greeting the user in one short sentence and offering today's ideas or research on anything.`
    // ask_user is a chat widget; by voice the desk just asks.
    const tools = TOOL_DECLS.filter((t) => t.name !== 'ask_user')
    this.session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: system,
        tools: [{ functionDeclarations: tools as any }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
      callbacks: {
        onopen: () => this.ev.onStatus('live'),
        onmessage: (m) => this.onMessage(m),
        onerror: (e) => this.ev.onStatus('error', (e as ErrorEvent).message || 'Connection error'),
        onclose: (e) => {
          this.ev.onStatus('closed', e.reason || undefined)
          this.teardown()
        },
      },
    })

    await this.startMic()
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: 'Hi' }] }], turnComplete: true })
    this.meter()
  }

  private async startMic() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    this.micCtx = new AudioContext({ sampleRate: 16000 })
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.micCtx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const src = this.micCtx.createMediaStreamSource(this.stream)
    this.inAnalyser = this.micCtx.createAnalyser()
    const node = new AudioWorkletNode(this.micCtx, 'pcm-capture')
    node.port.onmessage = (e) => {
      if (this.muted || !this.session) return
      this.session.sendRealtimeInput({ audio: { data: toBase64(e.data), mimeType: 'audio/pcm;rate=16000' } })
    }
    src.connect(this.inAnalyser)
    src.connect(node)
  }

  private onMessage(m: LiveServerMessage) {
    const sc = m.serverContent
    if (sc?.interrupted) this.stopPlayback()
    for (const p of sc?.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) this.play(p.inlineData.data)
    }
    if (sc?.inputTranscription?.text) this.ev.onTranscript('you', sc.inputTranscription.text, false)
    if (sc?.outputTranscription?.text) this.ev.onTranscript('desk', sc.outputTranscription.text, false)
    if (sc?.turnComplete) this.ev.onTranscript('desk', '', true)
    if (m.toolCall?.functionCalls?.length) void this.handleTools(m.toolCall.functionCalls)
  }

  private async handleTools(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
    const functionResponses = []
    const ui = {
      add: (p: ChatPart) => {
        this.ev.onPart(p)
        return p
      },
      emit: () => this.ev.onPartsChanged(),
    }
    for (const fc of calls) {
      try {
        const out = await runTool(fc.name ?? '', fc.args ?? {}, this.registry, ui)
        functionResponses.push({ id: fc.id, name: fc.name, response: out.result })
      } catch (err) {
        functionResponses.push({ id: fc.id, name: fc.name, response: { error: (err as Error).message } })
      }
      this.ev.onPartsChanged()
    }
    this.session?.sendToolResponse({ functionResponses })
  }

  private play(b64: string) {
    const ctx = this.outCtx!
    const pcm = new Int16Array(fromBase64(b64))
    const buf = ctx.createBuffer(1, pcm.length, 24000)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(this.outAnalyser!)
    this.playAt = Math.max(this.playAt, ctx.currentTime + 0.03)
    src.start(this.playAt)
    this.playAt += buf.duration
    this.playing.add(src)
    src.onended = () => this.playing.delete(src)
  }

  private stopPlayback() {
    this.playing.forEach((s) => s.stop())
    this.playing.clear()
    this.playAt = 0
  }

  private meter() {
    const read = (a?: AnalyserNode) => {
      if (!a) return 0
      const d = new Uint8Array(a.fftSize)
      a.getByteTimeDomainData(d)
      let sum = 0
      for (const v of d) sum += ((v - 128) / 128) ** 2
      return Math.min(1, Math.sqrt(sum / d.length) * 4)
    }
    const tick = () => {
      this.ev.onLevel(this.muted ? 0 : read(this.inAnalyser), read(this.outAnalyser))
      this.raf = requestAnimationFrame(tick)
    }
    tick()
  }

  setMuted(m: boolean) {
    this.muted = m
  }

  sendText(text: string) {
    this.session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true })
  }

  stop() {
    this.session?.close()
    this.teardown()
  }

  private teardown() {
    cancelAnimationFrame(this.raf)
    this.stopPlayback()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.micCtx?.close().catch(() => {})
    void this.outCtx?.close().catch(() => {})
    this.session = undefined
    this.micCtx = undefined
    this.outCtx = undefined
    this.ev.onLevel(0, 0)
  }
}
