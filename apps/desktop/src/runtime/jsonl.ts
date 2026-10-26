export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024

export class JsonlProtocolError extends Error {
  readonly code: 'invalid_utf8' | 'frame_too_large' | 'empty_frame' | 'invalid_json' | 'invalid_record' | 'incomplete_frame'

  constructor(code: JsonlProtocolError['code'], message: string) {
    super(message)
    this.name = 'JsonlProtocolError'
    this.code = code
  }
}

/**
 * Pi uses LF-delimited JSON, not readline's broader line-separator semantics.
 * The decoder is incremental so a UTF-8 code point split across chunks is
 * decoded correctly and stdout can be consumed continuously.
 */
export class StrictJsonlDecoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })
  private buffer = ''

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
    if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < 1) throw new Error('maxFrameBytes must be a positive integer')
  }

  feed(chunk: Uint8Array | string): Record<string, unknown>[] {
    let text: string
    try {
      text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    } catch {
      throw new JsonlProtocolError('invalid_utf8', 'Pi emitted invalid UTF-8')
    }
    this.buffer += text
    return this.drain()
  }

  finish(): Record<string, unknown>[] {
    try {
      this.buffer += this.decoder.decode()
    } catch {
      throw new JsonlProtocolError('invalid_utf8', 'Pi emitted invalid UTF-8')
    }
    const records = this.drain()
    if (this.buffer.length > 0) throw new JsonlProtocolError('incomplete_frame', 'Pi stdout ended with an incomplete JSONL frame')
    return records
  }

  private drain(): Record<string, unknown>[] {
    const records: Record<string, unknown>[] = []
    while (true) {
      const lineEnd = this.buffer.indexOf('\n')
      if (lineEnd < 0) {
        this.assertFrameSize(this.buffer)
        break
      }

      const rawLine = this.buffer.slice(0, lineEnd)
      this.buffer = this.buffer.slice(lineEnd + 1)
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (line.length === 0) throw new JsonlProtocolError('empty_frame', 'Pi emitted an empty JSONL frame')
      this.assertFrameSize(line)

      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        throw new JsonlProtocolError('invalid_json', 'Pi emitted malformed JSON')
      }
      if (!isRecord(value)) throw new JsonlProtocolError('invalid_record', 'Pi JSONL records must be objects')
      records.push(value)
    }
    return records
  }

  private assertFrameSize(frame: string) {
    if (new TextEncoder().encode(frame).byteLength > this.maxFrameBytes) {
      throw new JsonlProtocolError('frame_too_large', 'Pi JSONL frame exceeds the configured limit')
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
