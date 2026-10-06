import { deleteExpiredRecords } from '../lib/sessions'

export default defineNitroPlugin(nitroApp => {
  // Fail fast on configuration or migration errors instead of on the first request.
  useStudio().catch((error: Error) => {
    console.error(`[studio] startup failed: ${error.message}`)
  })

  const cleanup = setInterval(() => {
    useStudio()
      .then(studio => deleteExpiredRecords(studio))
      .catch(() => {})
  }, 60 * 60 * 1000)
  cleanup.unref()

  // PGlite must be closed so its data directory is flushed and released.
  nitroApp.hooks.hook('close', async () => {
    clearInterval(cleanup)
    await closeStudio()
  })
})
