import type { AppInstallationRecord } from '~~/server/lib/apps/store'
import { randomBytes } from 'node:crypto'
import { createTestStudio } from '@basyx/studio-sdk/testing'
import { describe, expect, it } from 'vitest'
import { appContentSecurityPolicy } from '~~/server/lib/apps/csp'
import { embedTokenKey, embedTokenTtlMs, isEmbeddable, issueEmbedToken, verifyEmbedToken } from '~~/server/lib/apps/embeds'
import { installationOriginsSource } from '~~/server/lib/apps/origins'
import { manifestOf } from './support'

// Views of other apps inline in an app's page (studio.ui.embedView, ADR 0051).

describe('embed tokens', () => {
  const key = embedTokenKey(randomBytes(32))
  const claims = { installationId: 'app-0123456789abcdef', path: 'ui/index.html', embedderOrigin: 'https://app-fedcba9876543210.apps.example.org' }

  it('round-trip the view, its entry and the embedding origin for an hour', () => {
    const now = Date.now()
    const token = issueEmbedToken(key, claims, now)
    expect(verifyEmbedToken(key, token, now + 1000)).toEqual({ ...claims, expiresAt: now + embedTokenTtlMs })
    expect(verifyEmbedToken(key, token, now + embedTokenTtlMs)).toBeNull()
  })

  it('are unique, also for the same view, embedding app and moment', () => {
    const now = Date.now()
    expect(issueEmbedToken(key, claims, now)).not.toBe(issueEmbedToken(key, claims, now))
  })

  it('are refused when signed with another key, altered or malformed', () => {
    const token = issueEmbedToken(key, claims)
    expect(verifyEmbedToken(embedTokenKey(randomBytes(32)), token)).toBeNull()
    const [prefix, payload, mac] = token.split('.')
    const altered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), o: 'https://evil.example' })).toString('base64url')
    expect(verifyEmbedToken(key, `${prefix}.${altered}.${mac}`)).toBeNull()
    expect(verifyEmbedToken(key, 'sev.forged.mac')).toBeNull()
    expect(verifyEmbedToken(key, `sct.${payload}.${mac}`)).toBeNull()
  })

  it('are signed with a key of their own, not the capability tokens\' key', () => {
    const dataKey = randomBytes(32)
    expect(embedTokenKey(dataKey).equals(embedTokenKey(dataKey))).toBe(true)
    expect(embedTokenKey(dataKey).equals(dataKey)).toBe(false)
  })
})

describe('embeddable views', () => {
  const record = (studioApi: string, bundled = false) => ({ bundled, manifest: manifestOf({ studioApi }) }) as Pick<AppInstallationRecord, 'bundled' | 'manifest'>

  it('ship with Studio or declare the app API whose SDK connects from another app\'s page', () => {
    expect(isEmbeddable(record('^0.1.0', true))).toBe(true)
    expect(isEmbeddable(record('^0.1.11'))).toBe(true)
    expect(isEmbeddable(record('>=0.1.11 <0.2.0'))).toBe(true)
    expect(isEmbeddable(record('^0.1.10'))).toBe(false)
    expect(isEmbeddable(record('^0.1.0'))).toBe(false)
  })
})

describe('frames of embedded views', () => {
  it('may come from any installation\'s origin, where each has its own', () => {
    expect(installationOriginsSource('https://{installation}.apps.example.org/app/')).toBe('https://*.apps.example.org')
    expect(installationOriginsSource('http://{installation}.apps.localhost:3400/app/')).toBe('http://*.apps.localhost:3400')
    expect(installationOriginsSource('https://apps.example.org/app/')).toBeNull()
    expect(installationOriginsSource('studio-app://')).toBeNull()
  })

  it('are added to frame-src next to declared origins', () => {
    const directive = (policy: string) => /frame-src ([^;]*)/.exec(policy)![1]
    const base = 'https://app-0123456789abcdef.apps.example.org/app/app-0123456789abcdef/'
    expect(directive(appContentSecurityPolicy(base, ['https://studio.example.org'], {}, { viewOrigins: 'https://*.apps.example.org' }))).toBe('https://*.apps.example.org')
    expect(directive(appContentSecurityPolicy(base, ['https://studio.example.org'], { frameOrigins: ['https://viewer.example.com'] }, { viewOrigins: 'https://*.apps.example.org' }))).toBe('https://viewer.example.com https://*.apps.example.org')
    expect(directive(appContentSecurityPolicy(base, ['https://studio.example.org'], {}, { viewOrigins: null }))).toBe(`'none'`)
  })
})

describe('the test Studio', () => {
  it('records the views an app embeds and answers with a URL that shows nothing', async () => {
    const studio = createTestStudio({ permissions: ['studio.ui.navigation'] })
    await expect(studio.client.ui.embedView('urn:example:sm:series', { shellId: 'urn:example:aas:1' })).resolves.toEqual({ url: 'about:blank#studio-embed=1' })
    expect(studio.embeddedViews).toEqual([{ submodelId: 'urn:example:sm:series', shellId: 'urn:example:aas:1' }])
    await expect(createTestStudio({ permissions: [] }).client.ui.embedView('urn:example:sm:series')).rejects.toMatchObject({ code: 'app_permission_not_declared' })
  })
})
