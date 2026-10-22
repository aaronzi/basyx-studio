import type { StudioClient } from '@basyx/studio-sdk'
import type { Component } from 'vue'
import type { Router } from 'vue-router'
import { createStudioHistory } from '@basyx/studio-app-kit/router'
import { createRouter } from 'vue-router'

// The module's pages are routes; Studio's URL carries the route as the
// module's sub-path (`…/inventory/shells/<key>`), so a page can be linked.
// Each page is a history entry: the browser's back button returns to the
// previous page (Studio app API 0.1.8).

export interface Pages {
  overview: Component
  shells: Component
  shell: Component
}

export function createAppRouter (client: StudioClient, pages: Pages): Router {
  return createRouter({
    history: createStudioHistory(client, { history: 'push' }),
    routes: [
      { path: '/', name: 'overview', component: pages.overview },
      { path: '/shells', name: 'shells', component: pages.shells },
      { path: '/shells/:shell', name: 'shell', component: pages.shell, props: true },
      { path: '/:rest(.*)', redirect: '/' },
    ],
  })
}
