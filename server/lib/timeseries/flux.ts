import { StudioProblem } from '../problem'

// Flux queries of LinkedSegments (ADR 0040). The query comes from AAS
// content, so Studio checks it before sending it with a connection's token.
// The real boundary is a read-only token limited to the needed buckets; this
// check is defence in depth against queries that write or reach out.

/** The packages a query may import; everything else (http, sql, secrets, experimental, …) is refused. */
export const allowedFluxImports = new Set(['strings', 'math', 'date', 'array', 'experimental/aggregate'])

/** The point count per graph that `v.windowPeriod` aims at, as in the BaSyx AAS Web UI. */
export const pointsPerGraph = 360

/** The query without comments and string contents, so checks see code only. */
function codeOf (query: string): string {
  return query
    .replaceAll(/"(?:[^"\\]|\\.)*"/g, '""')
    .replaceAll(/\/\/[^\n]*/g, '')
}

/** Refuses a query that imports other packages or writes (`to()`). */
export function checkFluxQuery (query: string): void {
  const imports = [...query.matchAll(/^\s*import\s+(?:\w+\s+)?"([^"]*)"/gm)].map(match => match[1]!)
  const refused = imports.filter(name => !allowedFluxImports.has(name))
  if (refused.length > 0) {
    throw new StudioProblem('connection_request_refused', `The Flux query imports ${refused.join(', ')}; Studio only sends queries that import ${[...allowedFluxImports].join(', ')}.`)
  }
  if (/(?:^|[^\w.])to\s*\(/.test(codeOf(query))) {
    throw new StudioProblem('connection_request_refused', 'The Flux query writes data (to()); Studio only sends queries that read.')
  }
}

export interface FluxRange {
  start: string
  stop: string
}

/**
 * Sets the dashboard variables of the BaSyx AAS Web UI: every `{{y-value}}`
 * becomes the value's record idShort (checked to be an idShort, so it cannot
 * carry Flux syntax), `v.timeRangeStart` and `v.timeRangeStop` the range, and
 * `v.windowPeriod` a period that gives about 360 points.
 */
export function interpolateFlux (query: string, value: string | null, range: FluxRange): string {
  const durationMs = Date.parse(range.stop) - Date.parse(range.start)
  const windowPeriodMs = Math.max(1, Math.round(durationMs / pointsPerGraph))
  const withValue = value === null ? query : query.replaceAll('{{y-value}}', value)
  return withValue
    .replaceAll(/\bv\.timeRangeStart\b/g, new Date(range.start).toISOString())
    .replaceAll(/\bv\.timeRangeStop\b/g, new Date(range.stop).toISOString())
    .replaceAll(/\bv\.windowPeriod\b/g, `${windowPeriodMs}ms`)
}

/** Whether the query is a template with one query per selected value. */
export function isValueTemplate (query: string): boolean {
  return query.includes('{{y-value}}')
}
