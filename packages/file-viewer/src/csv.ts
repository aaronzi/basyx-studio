// CSV and TSV for the table view (RFC 4180): quoted fields with
// delimiters, doubled quotes and line breaks, and the delimiter guessed from
// the first lines, as spreadsheets write with commas, semicolons, tabs or
// pipes.

/** The table view shows at most this many rows. */
export const csvRowLimit = 10_000

export interface CsvTable {
  delimiter: string
  rows: string[][]
  /** Rows after `csvRowLimit` were left out. */
  truncated: boolean
}

const candidates = [',', ';', '\t', '|']

/** Splits records, honouring quotes; up to `limit` records. */
function parse (text: string, delimiter: string, limit: number): { rows: string[][], truncated: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let index = 0
  const end = () => {
    row.push(field)
    field = ''
  }
  while (index < text.length) {
    const character = text[index]!
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index++
        } else {
          quoted = false
        }
      } else {
        field += character
      }
    } else if (character === '"' && field === '') {
      quoted = true
    } else if (character === delimiter) {
      end()
    } else if (character === '\n' || character === '\r') {
      end()
      rows.push(row)
      row = []
      if (character === '\r' && text[index + 1] === '\n') {
        index++
      }
      if (rows.length > limit) {
        return { rows: rows.slice(0, limit), truncated: true }
      }
    } else {
      field += character
    }
    index++
  }
  if (field !== '' || row.length > 0) {
    end()
    rows.push(row)
  }
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}

/** The delimiter that splits the first lines into the most columns, equally many on each. */
export function detectDelimiter (text: string): string {
  const sample = text.slice(0, 16_384)
  let best = ','
  let bestScore = 0
  for (const delimiter of candidates) {
    const { rows } = parse(sample, delimiter, 20)
    const counts = rows.filter(row => row.length > 1 || row[0] !== '').map(row => row.length)
    if (counts.length === 0 || counts[0]! < 2) {
      continue
    }
    // Consistent column counts weigh more than many columns.
    const consistent = counts.filter(count => count === counts[0]).length / counts.length
    const score = consistent * 10 + Math.min(counts[0]!, 50) / 50
    if (score > bestScore) {
      best = delimiter
      bestScore = score
    }
  }
  return best
}

export function parseCsv (text: string, delimiter: string | null = null): CsvTable {
  const chosen = delimiter ?? detectDelimiter(text)
  const { rows, truncated } = parse(text.replace(/^\uFEFF/, ''), chosen, csvRowLimit + 1)
  // A file's last line break ends the last record; it adds no empty row.
  while (rows.length > 0 && rows.at(-1)!.length === 1 && rows.at(-1)![0] === '') {
    rows.pop()
  }
  return { delimiter: chosen, rows, truncated }
}
