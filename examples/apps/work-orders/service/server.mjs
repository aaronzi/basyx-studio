// A mock work-order service for the work-orders example app (ADR 0047):
// the API of ../api/work-orders.openapi.json, in memory, with Node only.
// Studio calls it through an http connection; the browser never does.
//
//   node server.mjs                                  no authentication
//   SERVICE_TOKEN=secret node server.mjs             Authorization: Bearer secret
//   OIDC_ISSUER=… SERVICE_AUDIENCE=work-orders node server.mjs
//                                                    signed-in users' tokens (RS256, checked
//                                                    against the issuer's keys and the audience)
//
// With both, either is accepted. PORT (default 8080) and BASE_PATH (default
// /api/v1) say where it listens.

import { createPublicKey, timingSafeEqual, verify } from 'node:crypto'
import { createServer } from 'node:http'
import process from 'node:process'

const port = Number(process.env.PORT ?? 8080)
const basePath = (process.env.BASE_PATH ?? '/api/v1').replace(/\/+$/, '')
const staticToken = process.env.SERVICE_TOKEN ?? ''
const issuer = process.env.OIDC_ISSUER ?? ''
const audience = process.env.SERVICE_AUDIENCE ?? 'work-orders'

const orders = new Map()
let nextId = 1

function problem (status, title, detail) {
  return { status, headers: { 'Content-Type': 'application/problem+json' }, body: JSON.stringify({ type: 'about:blank', title, status, detail }) }
}

function json (status, value, headers = {}) {
  return { status, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) }
}

// --- Authentication ---------------------------------------------------------

let keys = null

/** The issuer's signing keys by key ID, read once from its JWKS. */
async function signingKeys () {
  if (!keys) {
    const configuration = await (await fetch(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`)).json()
    const { keys: jwks } = await (await fetch(configuration.jwks_uri)).json()
    keys = new Map(jwks.filter(key => key.kty === 'RSA' && key.use !== 'enc').map(key => [key.kid, createPublicKey({ key, format: 'jwk' })]))
  }
  return keys
}

/** The subject of a valid RS256 token for this service, or null. */
async function userOf (token) {
  const [header, payload, signature] = token.split('.')
  if (!header || !payload || !signature) {
    return null
  }
  const { alg, kid } = JSON.parse(Buffer.from(header, 'base64url').toString())
  const key = alg === 'RS256' ? (await signingKeys()).get(kid) : undefined
  if (!key || !verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'))) {
    return null
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (claims.iss !== issuer || !audiences.includes(audience) || claims.exp * 1000 < Date.now()) {
    return null
  }
  return { subject: claims.preferred_username ?? claims.sub, via: 'user' }
}

function sameSecret (given, expected) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Who calls: a user, the static token's holder, or anyone when no authentication is configured. */
async function callerOf (request) {
  if (!staticToken && !issuer) {
    return { subject: 'anonymous', via: 'none' }
  }
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
  if (!token) {
    return null
  }
  if (staticToken && sameSecret(token, staticToken)) {
    return { subject: 'static token', via: 'token' }
  }
  return issuer ? userOf(token).catch(() => null) : null
}

// --- Work orders ------------------------------------------------------------

function view (order) {
  const { photos, ...rest } = order
  return { ...rest, photos: [...photos.values()].map(({ id, caption, contentType }) => ({ id, caption, contentType })) }
}

function etagOf (order) {
  return `"${order.version}"`
}

function newOrder (body, caller) {
  if (typeof body?.title !== 'string' || !body.title.trim() || typeof body.asset !== 'string') {
    return problem(400, 'Invalid order', 'An order needs a title and an asset.')
  }
  const id = String(nextId++)
  const order = { id, asset: body.asset, title: body.title.trim(), status: 'open', due: body.due ?? null, createdBy: caller.subject, version: 1, photos: new Map() }
  orders.set(id, order)
  return json(201, view(order), { Location: `${basePath}/orders/${id}`, ETag: etagOf(order) })
}

function updateOrder (order, body, ifMatch) {
  if (ifMatch !== etagOf(order) && ifMatch !== '*') {
    return problem(412, 'The order changed', `The order is at version ${order.version}; read it again.`)
  }
  for (const field of ['title', 'status', 'due']) {
    if (body?.[field] !== undefined) {
      order[field] = body[field]
    }
  }
  order.version++
  return json(200, view(order), { ETag: etagOf(order) })
}

async function addPhoto (order, request, raw) {
  const form = await new Request('http://local/', { method: 'POST', headers: { 'content-type': request.headers['content-type'] ?? '' }, body: raw }).formData()
  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return problem(400, 'No photo', 'Send the photo as the file part.')
  }
  const id = String(order.photos.size + 1)
  order.photos.set(id, { id, caption: String(form.get('caption') ?? ''), contentType: file.type || 'application/octet-stream', bytes: Buffer.from(await file.arrayBuffer()) })
  order.version++
  return json(201, view(order), { Location: `${basePath}/orders/${order.id}/photos/${id}`, ETag: etagOf(order) })
}

async function answer (request, raw) {
  const url = new URL(request.url, 'http://local')
  if (!url.pathname.startsWith(`${basePath}/`) && url.pathname !== basePath) {
    return problem(404, 'Not found')
  }
  const path = url.pathname.slice(basePath.length) || '/'
  if (path === '/' && request.method === 'GET') {
    return json(200, { service: 'work-orders' })
  }
  const caller = await callerOf(request)
  if (!caller) {
    return problem(401, 'Not signed in', 'Send a valid bearer token.')
  }
  const body = () => {
    try {
      return JSON.parse(raw.toString('utf8'))
    } catch {
      return null
    }
  }
  if (path === '/me' && request.method === 'GET') {
    return json(200, caller)
  }
  if (path === '/orders') {
    if (request.method === 'GET') {
      const asset = url.searchParams.get('asset')
      const statuses = url.searchParams.getAll('status')
      return json(200, [...orders.values()].filter(order => (!asset || order.asset === asset) && (statuses.length === 0 || statuses.includes(order.status))).map(order => view(order)))
    }
    if (request.method === 'POST') {
      return newOrder(body(), caller)
    }
  }
  const match = /^\/orders\/([^/]+)(?:\/photos(?:\/([^/]+))?)?$/.exec(path)
  const order = match ? orders.get(decodeURIComponent(match[1])) : undefined
  if (!match) {
    return problem(404, 'Not found')
  }
  if (!order) {
    return problem(404, 'No such order', `There is no order ${decodeURIComponent(match[1])}.`)
  }
  const isPhotos = path.includes('/photos')
  if (!isPhotos && request.method === 'GET') {
    return json(200, view(order), { ETag: etagOf(order) })
  }
  if (!isPhotos && request.method === 'PUT') {
    return updateOrder(order, body(), request.headers['if-match'])
  }
  if (isPhotos && !match[2] && request.method === 'POST') {
    return addPhoto(order, request, raw)
  }
  const photo = match[2] ? order.photos.get(match[2]) : undefined
  if (photo && request.method === 'GET') {
    return { status: 200, headers: { 'Content-Type': photo.contentType }, body: photo.bytes }
  }
  return problem(404, 'Not found')
}

createServer((request, response) => {
  const chunks = []
  request.on('data', chunk => chunks.push(chunk))
  request.on('end', async () => {
    let reply
    try {
      reply = await answer(request, Buffer.concat(chunks))
    } catch (error) {
      reply = problem(500, 'Internal error', String(error?.message ?? error))
    }
    // Requests are logged without their headers, so tokens stay out of the log.
    console.info(`${request.method} ${request.url} → ${reply.status}`)
    response.writeHead(reply.status, reply.headers)
    response.end(reply.body)
  })
}).listen(port, () => {
  console.info(`Work-order service on :${port}${basePath} (${[staticToken && 'static token', issuer && `users of ${issuer}`].filter(Boolean).join(', ') || 'no authentication'})`)
})
