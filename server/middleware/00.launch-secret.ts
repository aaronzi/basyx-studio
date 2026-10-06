import { timingSafeEqual } from 'node:crypto'
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
  if (event.method === 'GET' && event.path.split('?', 1)[0] === callbackPath) {
    return
  }

  const provided = getHeader(event, launchSecretHeader)
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided ?? '')

  if (
    expectedBytes.length !== providedBytes.length
    || !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
})
