import { timingSafeEqual } from 'node:crypto'
import { createError, defineEventHandler, getRequestHeader } from 'nuxt/server'
import { callbackPath } from '../lib/urls'

const launchSecretHeader = 'x-studio-launch-secret'

export default defineEventHandler(event => {
  const expected = process.env.STUDIO_LAUNCH_SECRET
  if (!expected) {
    return
  }

  // The OIDC callback reaches the desktop service from the system browser,
  // which cannot know the launch secret. It is authenticated by its
  // single-use, server-side `state` instead.
  if (event.req.method === 'GET' && event.url.pathname === callbackPath) {
    return
  }

  const provided = getRequestHeader(event, launchSecretHeader)
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided ?? '')

  if (
    expectedBytes.length !== providedBytes.length
    || !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    throw createError({ status: 401, statusText: 'Unauthorized' })
  }
})
