import { describe, expect, it } from 'vitest'
import { createDevStudio } from '../ui/src/dev'
import { modelFiles, shellIdOf, shellPath } from '../ui/src/shells'

// The app's logic against the test Studio of @basyx/studio-sdk/testing:
// no Studio, no browser.

describe('modelFiles', () => {
  it('finds the 3D models of a submodel, also in collections', async () => {
    const studio = createDevStudio()
    const submodel = await studio.client.aas.getSubmodel('https://example.com/ids/sm/pump-01/models')
    expect(modelFiles(submodel)).toEqual([
      { path: 'Model01.ModelFile', fileName: 'pump.ifc', format: 'ifc', icon: 'mdi-cube-outline' },
      { path: 'Casing', fileName: 'casing.glb', format: 'glb', icon: 'mdi-cube-outline' },
    ])
  })
})

describe('the shell route', () => {
  it('carries any shell ID in the sub-path', () => {
    const id = 'https://example.com/ids/aas/pump-01?x=1'
    expect(shellPath(id)).toMatch(/^shells\/[\w-]+$/)
    expect(shellIdOf(shellPath(id))).toBe(id)
    expect(shellIdOf('')).toBeNull()
  })

  it('moves with navigate, as in Studio', async () => {
    const studio = createDevStudio()
    await studio.client.ui.navigate(shellPath('urn:a'))
    expect(shellIdOf(studio.client.context.subPath)).toBe('urn:a')
  })
})

describe('the test Studio', () => {
  it('refuses what the manifest does not declare', async () => {
    const studio = createDevStudio()
    await expect(studio.client.ui.copyText('x')).rejects.toMatchObject({ code: 'app_permission_not_declared' })
    await expect(studio.client.aas.listSubmodels('urn:missing')).rejects.toMatchObject({ code: 'target_resource_not_found' })
  })
})
