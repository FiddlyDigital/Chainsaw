/**
 * Generate the PWA icons.
 *
 * Rasterised here rather than committed as opaque binaries so the mark can be
 * changed by editing the maths below. The design is the app's own subject: a
 * sawtooth, the waveform the name points at, over a step grid.
 *
 *   node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [12, 14, 20]
const GRID = [32, 38, 52]
const WAVE = [246, 173, 85]
const ACCENT = [246, 109, 155]

function crc32(buffer) {
  let crc = ~0
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function png(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** @param {boolean} maskable leaves a safe margin for Android's mask. */
function draw(size, maskable) {
  const pixels = Buffer.alloc(size * size * 4)
  const put = (x, y, [r, g, b], alpha = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    const a = alpha / 255
    pixels[i] = Math.round(pixels[i] * (1 - a) + r * a)
    pixels[i + 1] = Math.round(pixels[i + 1] * (1 - a) + g * a)
    pixels[i + 2] = Math.round(pixels[i + 2] * (1 - a) + b * a)
    pixels[i + 3] = 255
  }

  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) put(x, y, BG)

  const inset = maskable ? size * 0.22 : size * 0.12
  const span = size - inset * 2

  // step grid: four bars of four
  for (let i = 0; i <= 16; i += 1) {
    const x = Math.round(inset + (span * i) / 16)
    for (let y = Math.round(inset); y < inset + span; y += 1) put(x, y, i % 4 === 0 ? ACCENT : GRID, i % 4 === 0 ? 90 : 150)
  }

  // sawtooth: four ramps across the grid, drawn thick
  const thickness = Math.max(2, Math.round(size / 40))
  const cycles = 4
  for (let px = 0; px < span; px += 0.25) {
    const phase = ((px / span) * cycles) % 1
    const y = inset + span * (0.78 - phase * 0.56)
    for (let t = -thickness; t <= thickness; t += 1) {
      put(Math.round(inset + px), Math.round(y + t), WAVE, 255 - (Math.abs(t) / (thickness + 1)) * 140)
    }
    // the vertical flyback edge
    if (phase > 0.985) {
      for (let y2 = inset + span * 0.22; y2 < inset + span * 0.78; y2 += 0.5) {
        for (let t = -1; t <= 1; t += 1) put(Math.round(inset + px + t), Math.round(y2), WAVE, 200)
      }
    }
  }

  return png(size, pixels)
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
]) {
  writeFileSync(join(OUT, name), draw(size, maskable))
  console.log(`wrote ${name} (${size}px)`)
}
