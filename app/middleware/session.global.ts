export default defineNuxtRouteMiddleware(async to => {
  const session = useSessionStore()
  await session.ensureLoaded()

  // The start page shows the sign-in prompt; everything else needs a session.
  if (session.needsLogin && to.path !== '/') {
    return navigateTo({ path: '/', query: { returnTo: to.fullPath } })
  }
  if (to.path.startsWith('/admin') && !session.isAdmin) {
    return navigateTo('/')
  }
})
