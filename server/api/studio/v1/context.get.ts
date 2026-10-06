import type { StudioContext } from '#shared/contract'

export default defineStudioHandler(async (): Promise<StudioContext> => {
  const studio = await useStudio()
  return {
    apiVersion: '1',
    deploymentMode: studio.config.deploymentMode,
    loginRequired: studio.config.deploymentMode === 'hosted',
  }
})
