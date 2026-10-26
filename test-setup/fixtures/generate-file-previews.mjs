// Generates the file preview fixture (open/studio-file-previews.aasx): a
// shell with an IDTA 02026 Models3D submodel, an IDTA 02004 Handover
// Documentation, a FileSystem submodel as the BaSyx AAS Web UI writes it, and
// a FileFormats submodel with text, image, PDF, audio and Blob content, files
// with misleading content types, missing content and external links,
// verified with AAS Core 3.1. Every file is written here (the 3D models come
// from generate-models3d.mjs), so the fixture carries no third-party content;
// external links point at stable public files.
//
// Run with: pnpm testenv:fixtures (after generate-models3d.mjs)

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { unzipSync, zipSync } from 'fflate'

const require = createRequire(import.meta.url)
const { jsonization, verification } = require('@aas-core-works/aas-core3.1-typescript')
const { NewPackaging } = require('aas-package3-typescript')

const fixturesDir = dirname(fileURLToPath(import.meta.url))
const modelsDir = join(fixturesDir, 'models3d')

// ---------------------------------------------------------------------------
// Images: PNG and BMP from a pixel function, drawn with a few primitives
// ---------------------------------------------------------------------------

/** An RGB canvas with lines, rectangles and circles. */
function canvas (width, height, background = [255, 255, 255]) {
  const pixels = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    pixels.set(background, i * 3)
  }
  const set = (x, y, color) => {
    if (x >= 0 && y >= 0 && x < width && y < height) {
      pixels.set(color, (Math.round(y) * width + Math.round(x)) * 3)
    }
  }
  return {
    width,
    height,
    pixels,
    rect (x, y, w, h, color) {
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          set(i, j, color)
        }
      }
    },
    line (x0, y0, x1, y1, color, thickness = 1) {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
      for (let s = 0; s <= steps; s++) {
        const x = x0 + ((x1 - x0) * s) / steps
        const y = y0 + ((y1 - y0) * s) / steps
        for (let t = -Math.floor(thickness / 2); t <= Math.floor((thickness - 1) / 2); t++) {
          for (let u = -Math.floor(thickness / 2); u <= Math.floor((thickness - 1) / 2); u++) {
            set(x + t, y + u, color)
          }
        }
      }
    },
    circle (cx, cy, r, color) {
      for (let j = -r; j <= r; j++) {
        for (let i = -r; i <= r; i++) {
          if (i * i + j * j <= r * r) {
            set(cx + i, cy + j, color)
          }
        }
      }
    },
    shade (colorAt) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          pixels.set(colorAt(x, y), (y * width + x) * 3)
        }
      }
    },
  }
}

function png (image) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(image.width, 0)
  header.writeUInt32BE(image.height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const rows = []
  for (let y = 0; y < image.height; y++) {
    rows.push(Buffer.from([0]), Buffer.from(image.pixels.subarray(y * image.width * 3, (y + 1) * image.width * 3)))
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** A 24-bit BMP: rows bottom-up, BGR, padded to four bytes. */
function bmp (image) {
  const stride = Math.ceil((image.width * 3) / 4) * 4
  const data = Buffer.alloc(stride * image.height)
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const source = (y * image.width + x) * 3
      const target = (image.height - 1 - y) * stride + x * 3
      data[target] = image.pixels[source + 2]
      data[target + 1] = image.pixels[source + 1]
      data[target + 2] = image.pixels[source]
    }
  }
  const header = Buffer.alloc(54)
  header.write('BM', 0, 'ascii')
  header.writeUInt32LE(54 + data.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(image.width, 18)
  header.writeInt32LE(image.height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(data.length, 34)
  header.writeInt32LE(2835, 38)
  header.writeInt32LE(2835, 42)
  return Buffer.concat([header, data])
}

const ink = [33, 33, 33]
const blue = [25, 118, 210]
const grey = [189, 189, 189]

/** The bracket's L profile as a dimensioned drawing (as in generate-models3d.mjs, 60 × 40 mm, 8 mm thick). */
function drawingImage () {
  const image = canvas(640, 400)
  const scale = 6
  const ox = 140
  const oy = 320
  const profile = [[0, 0], [60, 0], [60, 8], [8, 8], [8, 40], [0, 40]]
  for (let i = 0; i < profile.length; i++) {
    const [ax, az] = profile[i]
    const [bx, bz] = profile[(i + 1) % profile.length]
    image.line(ox + ax * scale, oy - az * scale, ox + bx * scale, oy - bz * scale, ink, 3)
  }
  // Dimension lines: width below, height on the left.
  image.line(ox, oy + 30, ox + 60 * scale, oy + 30, blue, 1)
  image.line(ox, oy + 20, ox, oy + 40, blue, 1)
  image.line(ox + 60 * scale, oy + 20, ox + 60 * scale, oy + 40, blue, 1)
  image.line(ox - 30, oy, ox - 30, oy - 40 * scale, blue, 1)
  image.line(ox - 40, oy, ox - 20, oy, blue, 1)
  image.line(ox - 40, oy - 40 * scale, ox - 20, oy - 40 * scale, blue, 1)
  image.rect(0, 0, 640, 4, blue)
  return image
}

function photoImage () {
  const image = canvas(320, 240)
  image.shade((x, y) => [Math.round(40 + (x / 320) * 60), Math.round(70 + (y / 240) * 80), Math.round(120 + (x / 320) * 100)])
  image.rect(60, 150, 200, 20, [120, 120, 120])
  image.rect(60, 70, 24, 80, [120, 120, 120])
  image.circle(240, 60, 26, [255, 213, 79])
  return image
}

/** A document page as a preview image: a coloured band and grey text lines. */
function pagePreview (band) {
  const image = canvas(120, 160, [250, 250, 250])
  image.rect(0, 0, 120, 26, band)
  for (let line = 0; line < 9; line++) {
    image.rect(12, 40 + line * 12, line % 3 === 2 ? 60 : 96, 4, grey)
  }
  return image
}

const drawingSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
  <title>Bracket, dimension drawing</title>
  <rect width="640" height="400" fill="#ffffff"/>
  <rect width="640" height="4" fill="#1976d2"/>
  <path d="M140 320 H500 V272 H188 V80 H140 Z" fill="none" stroke="#212121" stroke-width="3"/>
  <g stroke="#1976d2" stroke-width="1">
    <path d="M140 350 H500 M140 340 V360 M500 340 V360"/>
    <path d="M110 320 V80 M100 320 H120 M100 80 H120"/>
  </g>
  <g fill="#1976d2" font-family="sans-serif" font-size="16">
    <text x="320" y="375" text-anchor="middle">60 mm</text>
    <text x="96" y="205" text-anchor="end">40 mm</text>
  </g>
</svg>
`

// An SVG with a script: shown as an image, a browser runs none of it.
const scriptSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">
  <rect width="200" height="120" rx="12" fill="#e3f2fd"/>
  <text x="100" y="66" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#0d47a1">Script-free view</text>
  <script>document.documentElement.setAttribute('data-ran', 'true'); alert('This script must never run')</script>
</svg>
`

// ---------------------------------------------------------------------------
// PDF: pages of Helvetica text and simple vector drawings
// ---------------------------------------------------------------------------

function pdfText (text) {
  return text.replaceAll('\\', '\\\\').replaceAll('(', String.raw`\(`).replaceAll(')', String.raw`\)`)
}

/** A PDF of pages, each `{ lines: [[size, text]...], draw?: string }` (Latin-1 text). */
function pdf (pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']
  const kids = []
  for (const page of pages) {
    let y = 760
    const text = page.lines.map(([size, line]) => {
      y -= size * 1.6
      return `BT /F1 ${size} Tf 72 ${Math.round(y)} Td (${pdfText(line)}) Tj ET`
    }).join('\n')
    const stream = `${page.draw ?? ''}\n${text}`
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`)
    const contents = objects.length
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contents} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`)
    kids.push(`${objects.length} 0 R`)
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`
  let body = '%PDF-1.4\n'
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, 'latin1'))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(body, 'latin1')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

const band = '0.1 0.46 0.82 rg 0 812 595 30 re f'
const manualPdf = pdf([
  { draw: band, lines: [[24, 'Bracket BR-60'], [16, 'Operating manual'], [11, 'Version 2.1, October 2026'], [11, ''], [11, 'Studio test fixture: a document of five pages, to page through.']] },
  { draw: band, lines: [[18, '1 Safety'], [11, 'Mount the bracket only on load-bearing surfaces.'], [11, 'Do not exceed the static load of 250 N per bracket.'], [11, 'Wear gloves: the edges may be sharp after cutting.']] },
  { draw: `${band}\n0.13 0.13 0.13 RG 2 w 120 420 m 480 420 l 480 468 l 168 468 l 168 660 l 120 660 l h S`, lines: [[18, '2 Dimensions'], [11, 'The L profile is 60 mm wide, 40 mm high and 8 mm thick, 30 mm deep.']] },
  { draw: band, lines: [[18, '3 Mounting'], [11, '1. Mark the two holes 44 mm apart.'], [11, '2. Drill 5 mm holes and insert the anchors.'], [11, '3. Fasten the bracket with M4 screws (2.5 Nm).']] },
  { draw: band, lines: [[18, '4 Maintenance'], [11, 'Check the screws once a year. Replace a bent bracket (no repairs).'], [11, ''], [11, 'End of the manual.']] },
])
const conformityPdf = pdf([{
  draw: '0.18 0.49 0.2 rg 0 812 595 30 re f',
  lines: [[20, 'EU Declaration of Conformity'], [11, 'Product: Bracket BR-60'], [11, 'Manufacturer: Example Brackets GmbH, Musterstrasse 1, 12345 Musterstadt'], [11, 'We declare that the product conforms to the Machinery Directive 2006/42/EC.'], [11, ''], [11, 'Musterstadt, 2026-10-01'], [11, 'Studio test fixture, not a legal document.']],
}])
const blobPdf = pdf([{ lines: [[18, 'A PDF in a Blob'], [11, 'Base64 inside the element value.']] }])

// ---------------------------------------------------------------------------
// Text files, written here
// ---------------------------------------------------------------------------

const markdown = `# Bracket BR-60

Release notes for **version 2.1** of the bracket documentation. This file tests
the *rendered* Markdown view: headings, lists, tables, code, links and images.

## What changed

- New mounting instructions with torque values
- Dimension drawing as PNG and SVG
- [x] Reviewed by engineering
- [ ] Translated into German

1. Read the [operating manual](https://example.com/manual.pdf).
2. Check the table below.

| Property | Value | Unit |
| --- | ---: | --- |
| Width | 60 | mm |
| Height | 40 | mm |
| Static load | 250 | N |

> Brackets that are bent must be replaced, not repaired.

\`\`\`json
{ "model": "BR-60", "material": "S235", "thicknessMm": 8 }
\`\`\`

Inline \`code\`, a line break,
and a horizontal rule:

---

![External image (must not load without consent)](https://www.w3.org/Icons/w3c_home.png)

## What the sanitizer must remove

<script>alert('raw HTML script must never run')</script>
<img src="x" onerror="alert('onerror must never run')">
<a href="javascript:alert('javascript: links must not survive')">javascript link</a>
[Markdown javascript link](javascript:alert('no'))
<iframe src="https://example.com"></iframe>
`

const json = `${JSON.stringify({
  model: 'BR-60',
  material: { name: 'S235', standard: 'EN 10025-2' },
  dimensions: { widthMm: 60, heightMm: 40, depthMm: 30, thicknessMm: 8 },
  loads: [{ case: 'static', newtons: 250 }, { case: 'dynamic', newtons: 120 }],
  certified: true,
  notes: null,
}, null, 2)}\n`

const brokenJson = `{
  "model": "BR-60",
  "material": "S235",
  "dimensions": { "widthMm": 60, "heightMm": 40, },
  "missingQuote: true
}
`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- A machine configuration, to test XML highlighting and folding. -->
<configuration xmlns="urn:studio:test:config" version="2.1">
  <machine id="BR-60" type="bracket">
    <name lang="en">Bracket BR-60</name>
    <name lang="de">Winkel BR-60</name>
    <dimensions unit="mm" width="60" height="40" depth="30"/>
    <loads>
      <load case="static" unit="N">250</load>
      <load case="dynamic" unit="N">120</load>
    </loads>
  </machine>
  <notes><![CDATA[Use M4 screws & anchors <5 mm>.]]></notes>
</configuration>
`

const yaml = `# Line configuration
line: Assembly line 3
stations:
  - id: ST-10
    name: Press-fit
    cycleTimeSeconds: 12.5
    enabled: true
  - id: ST-20
    name: Screwing
    cycleTimeSeconds: 8
    tools: [screwdriver, torque-sensor]
    torque:
      targetNm: 2.5
      toleranceNm: 0.2
shiftPlan: |
  Early 06:00-14:00
  Late  14:00-22:00
`

const csvComma = `Timestamp,Station,Temperature,Pressure,Status
2026-10-26T08:00:00Z,ST-10,41.2,6.01,OK
2026-10-26T08:01:00Z,ST-10,41.6,6.03,OK
2026-10-26T08:02:00Z,ST-20,39.8,5.97,OK
2026-10-26T08:03:00Z,ST-20,52.4,5.12,WARNING
2026-10-26T08:04:00Z,ST-10,42.0,6.02,OK
`

// Semicolons, decimal commas and quoted fields with separators, quotes and a line break, as Excel writes them in German.
const csvSemicolon = `Artikel;Bezeichnung;Preis;Bemerkung
4711;"Winkel; verzinkt";2,49;Standard
4712;"Winkel ""Edelstahl""";5,90;"Zweizeilige
Bemerkung"
4713;Schraube M4;0,12;
`

const tsv = 'Parameter\tValue\tUnit\nSpindle speed\t12000\trpm\nFeed rate\t2500\tmm/min\nCoolant\ton\t\n'

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Bracket BR-60</title>
  <script>alert('HTML is shown as source, never rendered')</script>
</head>
<body>
  <h1>Bracket BR-60</h1>
  <p>Shown as source only.</p>
</body>
</html>
`

const javascript = `// Converts a torque from newton metres to pound-force inches.
export function toPoundForceInches (newtonMetres) {
  return newtonMetres * 8.850746
}

const torques = [2.5, 4, 10]
console.log(torques.map(toPoundForceInches))
`

const python = `"""Computes the static load of a bracket."""

from dataclasses import dataclass


@dataclass
class Bracket:
    width_mm: float
    thickness_mm: float

    def max_load(self, factor: float = 1.5) -> float:
        return self.width_mm * self.thickness_mm * 0.52 / factor


if __name__ == "__main__":
    print(Bracket(60, 8).max_load())
`

const ini = `; Controller settings
[network]
host = 192.168.0.10
port = 4840

[logging]
level = info
file = /var/log/controller.log
`

const toml = `# Edge gateway
title = "Gateway 7"

[opcua]
endpoint = "opc.tcp://192.168.0.10:4840"
security = ["Basic256Sha256", "Aes128_Sha256_RsaOaep"]

[[tags]]
name = "Temperature"
node = "ns=2;s=Line3.ST10.Temperature"
`

const gcode = `; Bracket BR-60, drilling the mounting holes
G21 ; millimetres
G90 ; absolute positions
M3 S12000
G0 X8 Y15 Z5
G81 R2 Z-9 F250
X52
G80
M5
M30
`

const structuredText = `(* IEC 61131-3 Structured Text: a press-fit step *)
FUNCTION_BLOCK FB_PressFit
VAR_INPUT
  Start : BOOL;
  ForceLimit : REAL := 2500.0;
END_VAR
VAR_OUTPUT
  Done : BOOL;
END_VAR
VAR
  Force : REAL;
END_VAR

IF Start AND Force < ForceLimit THEN
  Force := Force + 10.0;
ELSIF Force >= ForceLimit THEN
  Done := TRUE;
END_IF;
END_FUNCTION_BLOCK
`

const plainText = `Bracket BR-60

A plain text file with Unicode: Ä Ö Ü ß é ñ 漢字 ✓ – “quotes”.
Tabs\tseparate\tcolumns\there.
`

const log = `2026-10-26T08:00:00.120Z INFO  controller  Started (firmware 4.2.1)
2026-10-26T08:00:01.004Z INFO  opcua       Session opened with 192.168.0.42
2026-10-26T08:03:12.880Z WARN  station.20  Temperature 52.4 °C above 50.0 °C
2026-10-26T08:03:13.002Z ERROR station.20  Pressure 5.12 bar below 5.50 bar, stopping
2026-10-26T08:05:00.000Z INFO  station.20  Restarted by operator
`

/** About 11 MiB of log lines: above the text viewer's 10 MiB limit. */
function largeLog () {
  const lines = []
  let size = 0
  for (let i = 0; size < 11 * 1024 * 1024; i++) {
    const seconds = String(i % 60).padStart(2, '0')
    const minutes = String(Math.floor(i / 60) % 60).padStart(2, '0')
    const line = `2026-10-26T08:${minutes}:${seconds}.000Z INFO  station.${10 + (i % 3) * 10}  Reading ${String(i).padStart(7, '0')}: temperature ${(40 + (i % 50) / 10).toFixed(1)} °C\n`
    lines.push(line)
    size += Buffer.byteLength(line)
  }
  return Buffer.from(lines.join(''))
}

/** Deterministic bytes that are not text. */
function binary (length) {
  const bytes = Buffer.alloc(length)
  let state = 0x12_34_56_78
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0
    bytes[i] = state >>> 24
  }
  bytes[16] = 0
  return bytes
}

/** One and a half seconds of a 440 Hz tone, 8 kHz mono 16-bit WAV. */
function wav () {
  const rate = 8000
  const samples = rate * 1.5
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 400, (samples - i) / 400)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000 * fade), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('UTF-16 LE text with a byte order mark: Grüße, 日本語.\n', 'utf16le')])
const latin1 = Buffer.from('Latin-1 text: Größe, Maße, Preis 5 € is not in Latin-1, so it says EUR; café, naïve.\n'.replace('€', 'EUR'), 'latin1')

// ---------------------------------------------------------------------------
// The package's files
// ---------------------------------------------------------------------------

const text = value => Buffer.from(value)

/** Files of this fixture, by name, stored under /aasx/files/file-previews/. */
const files = {
  'operating-manual.pdf': { content: manualPdf, contentType: 'application/pdf' },
  'declaration-of-conformity.pdf': { content: conformityPdf, contentType: 'application/pdf' },
  'dimension-drawing.png': { content: png(drawingImage()), contentType: 'image/png' },
  'dimension-drawing.svg': { content: text(drawingSvg), contentType: 'image/svg+xml' },
  'product-photo.bmp': { content: bmp(photoImage()), contentType: 'image/bmp' },
  'release-notes.md': { content: text(markdown), contentType: 'text/markdown' },
  'preview-manual.png': { content: png(pagePreview([25, 118, 210])), contentType: 'image/png' },
  'preview-conformity.png': { content: png(pagePreview([46, 125, 50])), contentType: 'image/png' },
  'preview-drawing.png': { content: png(pagePreview([245, 124, 0])), contentType: 'image/png' },
  'preview-notes.png': { content: png(pagePreview([123, 31, 162])), contentType: 'image/png' },
  'notes.txt': { content: text(plainText), contentType: 'text/plain' },
  'controller.log': { content: text(log), contentType: 'text/plain' },
  'bracket.json': { content: text(json), contentType: 'application/json' },
  'broken.json': { content: text(brokenJson), contentType: 'application/json' },
  'configuration.xml': { content: text(xml), contentType: 'application/xml' },
  'line.yaml': { content: text(yaml), contentType: 'application/yaml' },
  'measurements.csv': { content: text(csvComma), contentType: 'text/csv' },
  'price-list.csv': { content: text(csvSemicolon), contentType: 'text/csv' },
  'parameters.tsv': { content: text(tsv), contentType: 'text/tab-separated-values' },
  'page.html': { content: text(html), contentType: 'text/html' },
  'script.svg': { content: text(scriptSvg), contentType: 'image/svg+xml' },
  'torque.js': { content: text(javascript), contentType: 'text/javascript' },
  'bracket.py': { content: text(python), contentType: 'text/x-python' },
  'controller.ini': { content: text(ini), contentType: 'text/plain' },
  'gateway.toml': { content: text(toml), contentType: 'application/toml' },
  'drilling.nc': { content: text(gcode), contentType: 'text/plain' },
  'press-fit.st': { content: text(structuredText), contentType: 'text/plain' },
  // Detection: the content type is missing, generic or wrong.
  'README.md': { content: text(markdown), contentType: 'application/octet-stream' },
  'LICENSE': { content: text('Studio test fixture without a file extension.\nPermission is granted to use it for tests.\n'), contentType: 'application/octet-stream' },
  'mislabelled.txt': { content: text(plainText), contentType: 'image/png' },
  'firmware.bin': { content: binary(4096), contentType: 'text/plain' },
  'legacy-latin1.txt': { content: latin1, contentType: 'text/plain; charset=ISO-8859-1' },
  'utf16.txt': { content: utf16, contentType: 'text/plain' },
  'large.log': { content: largeLog(), contentType: 'text/plain' },
  // No preview: download only.
  'specification.docx': { content: text('Not a real DOCX: only its content type matters.\n'), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  'tone.wav': { content: wav(), contentType: 'audio/wav' },
}

const filePath = name => `/aasx/files/file-previews/${name}`

// The 3D models of generate-models3d.mjs, under their own folder.
const models3dJson = JSON.parse(readFileSync(join(modelsDir, 'studio-3d-models.json'), 'utf8'))
const models3dTemplate = models3dJson.submodels.find(submodel => submodel.semanticId?.keys?.[0]?.value === 'https://admin-shell.io/idta/Models3D/1/0')
const modelFiles = new Map()
function collectModelFiles (node) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectModelFiles(item)
    }
  } else if (node && typeof node === 'object') {
    if (node.modelType === 'File' && typeof node.value === 'string' && node.value.startsWith('/aasx/files/models3d/')) {
      modelFiles.set(node.value, node.contentType)
    }
    for (const value of Object.values(node)) {
      collectModelFiles(value)
    }
  }
}
collectModelFiles(models3dTemplate)

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const reference = value => ({ type: 'ExternalReference', keys: [{ type: 'GlobalReference', value }] })
const en = textValue => [{ language: 'en', text: textValue }]

function prop (idShort, semanticId, value, valueType = 'xs:string') {
  return { ...(idShort ? { idShort } : {}), modelType: 'Property', ...(semanticId ? { semanticId: reference(semanticId) } : {}), valueType, value }
}

function mlp (idShort, semanticId, english, german) {
  return { idShort, modelType: 'MultiLanguageProperty', semanticId: reference(semanticId), value: [...en(english), ...(german ? [{ language: 'de', text: german }] : [])] }
}

function smc (idShort, semanticId, value, extra = {}) {
  return { ...(idShort ? { idShort } : {}), modelType: 'SubmodelElementCollection', ...(semanticId ? { semanticId: reference(semanticId) } : {}), ...extra, value }
}

function sml (idShort, semanticId, elementSemanticId, typeValueListElement, value, valueTypeListElement) {
  return {
    idShort,
    modelType: 'SubmodelElementList',
    semanticId: reference(semanticId),
    semanticIdListElement: reference(elementSemanticId),
    typeValueListElement,
    ...(valueTypeListElement ? { valueTypeListElement } : {}),
    value,
  }
}

/** A File element of one of `files`, or of an external address. */
function file (idShort, name, options = {}) {
  const { semanticId, description } = options
  return {
    ...(idShort ? { idShort } : {}),
    modelType: 'File',
    ...(description ? { description: en(description) } : {}),
    ...(semanticId ? { semanticId: reference(semanticId) } : {}),
    contentType: options.contentType ?? files[name].contentType,
    value: options.value ?? filePath(name),
  }
}

function external (idShort, url, contentType, description) {
  return { ...(idShort ? { idShort } : {}), modelType: 'File', description: en(description), contentType, value: url }
}

function blob (idShort, content, contentType, description) {
  return { idShort, modelType: 'Blob', description: en(description), contentType, value: Buffer.from(content).toString('base64') }
}

// ---------------------------------------------------------------------------
// Handover Documentation (IDTA 02004-1-2, as server/lib/templates/handover-documentation.json)
// ---------------------------------------------------------------------------

const hd = {
  documents: '0173-1#02-ABI500#003',
  document: '0173-1#02-ABI500#003/0173-1#01-AHF579#003',
  ids: '0173-1#02-ABI501#003',
  id: '0173-1#02-ABI501#003/0173-1#01-AHF580#003',
  classifications: '0173-1#02-ABI502#003',
  classification: '0173-1#02-ABI502#003/0173-1#01-AHF581#003',
  versions: '0173-1#02-ABI503#003',
  version: '0173-1#02-ABI503#003/0173-1#01-AHF582#003',
  language: '0173-1#02-AAN468#008',
  digitalFiles: '0173-1#02-ABK126#002',
}

function document ({ id, classId, className, title, description, version, date, digitalFiles, preview }) {
  return smc(undefined, hd.document, [
    sml('DocumentIds', hd.ids, hd.id, 'SubmodelElementCollection', [smc(undefined, hd.id, [
      prop('DocumentDomainId', '0173-1#02-ABH994#003', 'StudioFixtures'),
      prop('DocumentIdentifier', '0173-1#02-AAO099#004', id),
      prop('DocumentIsPrimary', '0173-1#02-ABH995#003', 'true', 'xs:boolean'),
    ])]),
    sml('DocumentClassifications', hd.classifications, hd.classification, 'SubmodelElementCollection', [smc(undefined, hd.classification, [
      prop('ClassId', '0173-1#02-ABH996#003', classId),
      mlp('ClassName', '0173-1#02-ABJ219#002', className),
      prop('ClassificationSystem', '0173-1#02-ABH997#003', 'VDI2770:2020'),
    ])]),
    sml('DocumentVersions', hd.versions, hd.version, 'SubmodelElementCollection', [smc(undefined, hd.version, [
      sml('Language', hd.language, hd.language, 'Property', [prop(undefined, hd.language, 'en')], 'xs:string'),
      prop('Version', '0173-1#02-AAP003#005', version),
      mlp('Title', '0173-1#02-ABG940#003', title),
      mlp('Description', '0173-1#02-AAN466#004', description),
      prop('StatusSetDate', '0173-1#02-ABI000#003', date, 'xs:date'),
      prop('StatusValue', '0173-1#02-ABI001#003', 'Released'),
      prop('OrganizationShortName', 'https://api.eclass-cdp.com/0173-1-02-ABI002-003', 'Example Brackets'),
      prop('OrganizationOfficialName', '0173-1#02-ABI004#003', 'Example Brackets GmbH'),
      sml('DigitalFiles', hd.digitalFiles, hd.digitalFiles, 'File', digitalFiles.map(item => ({ ...item, semanticId: reference(hd.digitalFiles) }))),
      ...(preview ? [file('PreviewFile', preview, { semanticId: '0173-1#02-ABK127#002' })] : []),
    ])]),
  ])
}

const ids = {
  shell: 'urn:studio:test:aas:file-previews',
  models3d: 'urn:studio:test:sm:file-previews:models3d',
  handover: 'urn:studio:test:sm:file-previews:handover-documentation',
  formats: 'urn:studio:test:sm:file-previews:file-formats',
  fileSystem: 'urn:studio:test:sm:file-previews:file-system',
}

const handoverSubmodel = {
  modelType: 'Submodel',
  id: ids.handover,
  idShort: 'HandoverDocumentation',
  semanticId: reference('0173-1#01-AHF578#003'),
  submodelElements: [sml('Documents', hd.documents, hd.document, 'SubmodelElementCollection', [
    document({ id: 'BR-60-OM', classId: '03-02', className: 'Operation', title: 'Operating manual', description: 'Five pages to page through.', version: '2.1', date: '2026-10-01', digitalFiles: [file(undefined, 'operating-manual.pdf')], preview: 'preview-manual.png' }),
    document({ id: 'BR-60-DOC', classId: '01-04', className: 'Certificate, declaration', title: 'Declaration of conformity', description: 'A single-page PDF.', version: '1.0', date: '2026-10-01', digitalFiles: [file(undefined, 'declaration-of-conformity.pdf')], preview: 'preview-conformity.png' }),
    document({ id: 'BR-60-DRW', classId: '02-02', className: 'Drawings, plans', title: 'Dimension drawing', description: 'The same drawing as PNG and as SVG.', version: '1.0', date: '2026-09-15', digitalFiles: [file(undefined, 'dimension-drawing.png'), file(undefined, 'dimension-drawing.svg')], preview: 'preview-drawing.png' }),
    document({ id: 'BR-60-PHO', classId: '01-01', className: 'Identification', title: 'Product photo', description: 'A BMP image.', version: '1.0', date: '2026-09-15', digitalFiles: [file(undefined, 'product-photo.bmp')] }),
    document({ id: 'BR-60-RN', classId: '02-04', className: 'Certificates, technical specification', title: 'Release notes', description: 'Markdown, to show rendered.', version: '2.1', date: '2026-10-20', digitalFiles: [file(undefined, 'release-notes.md')], preview: 'preview-notes.png' }),
    // External documents: one host allows cross-origin reads (CORS), one does not.
    document({ id: 'EXT-TM', classId: '02-04', className: 'Certificates, technical specification', title: 'Research paper (external, CORS)', description: 'A 14-page PDF at an external host that allows cross-origin reads.', version: '1.0', date: '2009-06-15', digitalFiles: [external(undefined, 'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf', 'application/pdf', 'pdf.js test document')] }),
    document({ id: 'EXT-W3C', classId: '02-04', className: 'Certificates, technical specification', title: 'Data sheet (external, no CORS)', description: 'A PDF at an external host without CORS headers.', version: '1.0', date: '2026-01-01', digitalFiles: [external(undefined, 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', 'application/pdf', 'W3C dummy PDF')] }),
  ])],
}

// ---------------------------------------------------------------------------
// FileFormats: every kind of preview and its edge cases
// ---------------------------------------------------------------------------

const formats = 'https://basyx.org/studio/examples/FileFormats/1/0'
const formatsSubmodel = {
  modelType: 'Submodel',
  id: ids.formats,
  idShort: 'FileFormats',
  description: en('Files of every kind the file viewer shows, and the cases it must handle.'),
  semanticId: reference(formats),
  submodelElements: [
    smc('Text', null, [
      file('PlainText', 'notes.txt', { description: 'UTF-8 with umlauts, CJK and symbols' }),
      file('Log', 'controller.log'),
      file('Markdown', 'release-notes.md', { description: 'Rendered view; the sanitizer removes the raw HTML at the end' }),
      file('Json', 'bracket.json'),
      file('JsonBroken', 'broken.json', { description: 'Syntax errors as diagnostics' }),
      file('Xml', 'configuration.xml'),
      file('Yaml', 'line.yaml'),
      file('CsvComma', 'measurements.csv'),
      file('CsvSemicolon', 'price-list.csv', { description: 'Semicolons, decimal commas, quotes and a line break in a field' }),
      file('Tsv', 'parameters.tsv'),
      file('Html', 'page.html', { description: 'Source only, never rendered' }),
      file('JavaScript', 'torque.js'),
      file('Python', 'bracket.py'),
      file('Ini', 'controller.ini', { description: 'text/plain; the language comes from the extension' }),
      file('Toml', 'gateway.toml'),
      file('GCode', 'drilling.nc'),
      file('StructuredText', 'press-fit.st', { description: 'IEC 61131-3' }),
    ]),
    smc('Images', null, [
      file('Png', 'dimension-drawing.png'),
      file('Svg', 'dimension-drawing.svg'),
      file('SvgWithScript', 'script.svg', { description: 'Its script must never run' }),
      file('Bmp', 'product-photo.bmp'),
    ]),
    smc('Documents', null, [
      file('PdfMultiPage', 'operating-manual.pdf'),
      file('PdfSinglePage', 'declaration-of-conformity.pdf'),
    ]),
    smc('Detection', null, [
      file('MarkdownAsOctetStream', 'README.md', { description: 'application/octet-stream: Markdown by its extension' }),
      file('NoExtension', 'LICENSE', { description: 'application/octet-stream without an extension: text by its content' }),
      file('TextAsPng', 'mislabelled.txt', { description: 'Declared as image/png, but text' }),
      file('BinaryAsText', 'firmware.bin', { description: 'Declared as text/plain, but binary: no text preview' }),
      file('Latin1', 'legacy-latin1.txt', { description: 'ISO-8859-1, declared by the charset parameter' }),
      file('Utf16', 'utf16.txt', { description: 'UTF-16 LE with a byte order mark' }),
      file('LargeText', 'large.log', { description: 'About 11 MiB: above the 10 MiB text limit' }),
    ]),
    smc('Missing', null, [
      { idShort: 'EmptyValue', modelType: 'File', description: en('A File without a value'), contentType: 'text/plain' },
      file('NotOnServer', null, { contentType: 'text/plain', value: filePath('not-on-server.txt'), description: 'Names a file the server does not have' }),
    ]),
    smc('External', null, [
      external('MarkdownCors', 'https://raw.githubusercontent.com/eclipse-basyx/basyx-studio/main/README.md', 'text/markdown', 'Markdown at a host that allows cross-origin reads'),
      external('PdfCors', 'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf', 'application/pdf', 'A 14-page PDF at a host that allows cross-origin reads; the host says application/octet-stream'),
      external('TextNoCors', 'https://www.gnu.org/licenses/gpl-3.0.txt', 'text/plain', 'Text at a host without CORS headers: through Studio\'s server'),
      external('PdfNoCors', 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', 'application/pdf', 'A PDF at a host without CORS headers'),
      external('XmlNoCors', 'https://www.w3.org/2001/XMLSchema.xsd', 'application/xml', 'XML Schema at a host without CORS headers'),
      external('SvgServedAsText', 'https://raw.githubusercontent.com/eclipse-basyx/basyx-studio/main/public/favicon.svg', 'image/svg+xml', 'The host says text/plain; the element\'s content type wins'),
      external('ImageRedirect', 'https://www.w3.org/Icons/w3c_home.png', 'image/png', 'The address redirects (301)'),
      external('Unreachable', 'https://files.invalid/missing.txt', 'text/plain', 'A host that does not exist'),
    ]),
    smc('Blobs', null, [
      blob('TextBlob', plainText, 'text/plain', 'Text in a Blob'),
      blob('JsonBlob', json, 'application/json', 'JSON in a Blob'),
      blob('MarkdownBlob', markdown, 'text/markdown', 'Markdown in a Blob'),
      blob('CsvBlob', csvComma, 'text/csv', 'CSV in a Blob'),
      blob('PngBlob', files['preview-manual.png'].content, 'image/png', 'An image in a Blob'),
      blob('SvgBlob', drawingSvg, 'image/svg+xml', 'An SVG in a Blob'),
      blob('PdfBlob', blobPdf, 'application/pdf', 'A PDF in a Blob'),
      blob('StlBlob', readFileSync(join(modelsDir, 'bracket.stl')), 'model/stl', 'A self-contained 3D model in a Blob'),
    ]),
    smc('Other', null, [
      file('Audio', 'tone.wav', { description: 'A 440 Hz tone' }),
      file('OfficeDocument', 'specification.docx', { description: 'No preview: download only' }),
    ]),
  ],
}

// ---------------------------------------------------------------------------
// FileSystem, as the BaSyx AAS Web UI's FileSystem plugin writes it
// (apps/file-system/ui/src/fileSystem.ts)
// ---------------------------------------------------------------------------

const folderSemanticId = 'https://basyx.org/submodels/Folder'
const folder = (timestamp, name, value) => smc(`FOLDER_${timestamp}`, folderSemanticId, value, { displayName: en(name) })
const fsFile = name => file(name.replace(/\.[^.]+$/, '').replaceAll(/[^\w-]/g, '_'), name)

const fileSystemSubmodel = {
  modelType: 'Submodel',
  id: ids.fileSystem,
  idShort: 'FileSystem',
  semanticId: reference('https://basyx.org/FileSystem/FileSystem/0/1'),
  submodelElements: [
    folder(1_761_465_600_000, 'Documents', [fsFile('operating-manual.pdf'), fsFile('declaration-of-conformity.pdf'), fsFile('release-notes.md')]),
    folder(1_761_465_600_001, 'Images', [fsFile('dimension-drawing.png'), fsFile('script.svg'), fsFile('product-photo.bmp')]),
    folder(1_761_465_600_002, 'Data', [
      fsFile('bracket.json'),
      fsFile('measurements.csv'),
      fsFile('line.yaml'),
      fsFile('configuration.xml'),
      folder(1_761_465_600_003, 'Programs', [fsFile('drilling.nc'), fsFile('press-fit.st'), fsFile('torque.js')]),
    ]),
    fsFile('notes.txt'),
    fsFile('tone.wav'),
    external('ExternalReadme', 'https://raw.githubusercontent.com/eclipse-basyx/basyx-studio/main/README.md', 'text/markdown', 'An external file'),
  ],
}

// ---------------------------------------------------------------------------
// Models3D: the submodel of studio-3d-models.aasx under its own identifier
// ---------------------------------------------------------------------------

const models3dSubmodel = { ...structuredClone(models3dTemplate), id: ids.models3d }

const environment = {
  assetAdministrationShells: [{
    modelType: 'AssetAdministrationShell',
    id: ids.shell,
    idShort: 'FilePreviewsDemo',
    displayName: en('File previews demo'),
    description: en('Every kind of file the file viewer shows: 3D models, handover documents, text formats, Blobs and external links.'),
    // The open infrastructure holds instances only (test/integration/live-target-search.test.ts).
    assetInformation: {
      assetKind: 'Instance',
      globalAssetId: 'urn:studio:test:asset:file-previews',
      defaultThumbnail: { path: '/thumbnail.png', contentType: 'image/png' },
    },
    submodels: [ids.models3d, ids.handover, ids.formats, ids.fileSystem].map(id => ({ type: 'ModelReference', keys: [{ type: 'Submodel', value: id }] })),
  }],
  submodels: [models3dSubmodel, handoverSubmodel, formatsSubmodel, fileSystemSubmodel],
}

// ---------------------------------------------------------------------------
// Verify and write
// ---------------------------------------------------------------------------

const parsed = jsonization.environmentFromJsonable(environment)
if (parsed.error !== null) {
  throw new Error(`deserialization failed at ${parsed.error.path}: ${parsed.error.message}`)
}
// IDTA 02026 names the vector components `X`, `Y` and `Z` (see generate-models3d.mjs).
function vectorComponent (error, environmentJson) {
  const element = error.path.toString().match(/\[\d+\]|\.\w+/g)?.reduce((node, step) => node?.[step.replaceAll(/[.[\]]/g, '')], environmentJson)
  return error.path.toString().endsWith('.idShort') && ['X', 'Y', 'Z'].includes(element)
}
const errors = [...verification.verify(parsed.mustValue())].filter(error => !vectorComponent(error, environment))
if (errors.length > 0) {
  throw new Error(errors.map(error => `${error.path}: ${error.message}`).join('\n'))
}
const canonical = jsonization.toJsonable(parsed.mustValue())

const thumbnail = png(drawingImage())
const aasxPath = join(fixturesDir, 'open', 'studio-file-previews.aasx')
const pkg = await NewPackaging().Create(aasxPath)
try {
  const spec = await pkg.PutPart(new URL('https://package.local/aasx/data.json'), 'application/json', new TextEncoder().encode(JSON.stringify(canonical)))
  await pkg.MakeSpec(spec)
  const parts = [
    ...Object.entries(files).map(([name, { content, contentType }]) => [filePath(name), contentType.split(';', 1)[0], content]),
    ...[...modelFiles].map(([path, contentType]) => [path, contentType, readFileSync(join(modelsDir, path.split('/').pop()))]),
  ]
  for (const [path, contentType, content] of parts) {
    const part = await pkg.PutPart(new URL(`https://package.local${path}`), contentType, new Uint8Array(content))
    await pkg.RelateSupplementaryToSpec(part, spec)
  }
  await pkg.SetThumbnail(await pkg.PutPart(new URL('https://package.local/thumbnail.png'), 'image/png', new Uint8Array(thumbnail)))
  await pkg.Flush()
} finally {
  pkg.Close()
}
// The packaging library stores its parts uncompressed; deflated, the large
// text file takes a few hundred KiB instead of 11 MiB in the repository.
writeFileSync(aasxPath, zipSync(unzipSync(readFileSync(aasxPath)), { level: 9, mtime: new Date('2026-10-26T00:00:00Z') }))
console.log(`wrote open/studio-file-previews.aasx (${Object.keys(files).length + modelFiles.size} files)`)
