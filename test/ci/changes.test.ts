import { describe, expect, it } from 'vitest'
import { globToRegExp, jobs, plan, verdict } from '../../scripts/ci-changes.mjs'

/** The jobs a pull request with these files runs. */
function running (files: string[] | undefined, labels: string[] = []) {
  return Object.entries(plan({ event: 'pull_request', labels, files })).filter(([, job]) => job.run).map(([job]) => job).toSorted()
}

const always = ['build', 'lint', 'typecheck', 'unit']
const every = Object.keys(jobs).toSorted()

describe('CI path rules', () => {
  it('matches folders with ** and one level with *', () => {
    expect(globToRegExp('app/**').test('app/components/X.vue')).toBe(true)
    expect(globToRegExp('app/**').test('apps/nameplate/x.ts')).toBe(false)
    expect(globToRegExp('**/*.md').test('README.md')).toBe(true)
    expect(globToRegExp('**/*.md').test('apps/nameplate/README.md')).toBe(true)
    expect(globToRegExp('*').test('package.json')).toBe(true)
    expect(globToRegExp('*').test('app/app.vue')).toBe(false)
    expect(globToRegExp('server/lib/config.ts').test('server/lib/configXts')).toBe(false)
  })

  it('runs every job outside pull requests', () => {
    for (const event of ['push', 'schedule', 'workflow_dispatch']) {
      expect(Object.values(plan({ event, files: [] })).every(job => job.run)).toBe(true)
    }
  })

  it('runs every job with the ci:full label, for unknown files and for root files', () => {
    expect(running(['docs/x.md'], ['ci:full'])).toEqual(every)
    expect(running(undefined)).toEqual(every)
    expect(running(['pnpm-lock.yaml'])).toEqual(every)
    expect(running(['Dockerfile'])).toEqual(every)
    expect(running(['.github/workflows/ci.yml'])).toEqual(every)
    expect(running(['scripts/ci-changes.mjs'])).toEqual(every)
  })

  it('runs only the jobs that always run for docs, unit tests and other workflows', () => {
    expect(running(['README.md', 'docs/development/ci.md'])).toEqual(always)
    expect(running(['test/aas/values.test.ts'])).toEqual(always)
    expect(running(['.github/workflows/docker-release.yml'])).toEqual(always)
  })

  it('runs the tests of Studio for its code, but not the narrow jobs', () => {
    expect(running(['app/components/WelcomeScreen.vue'])).toEqual([...always, 'desktop-e2e', 'e2e-web', 'integration'].toSorted())
  })

  it('runs the narrow jobs for their paths', () => {
    expect(running(['server/lib/containers/manager.ts'])).toContain('containers')
    expect(running(['docker/start.mjs'])).toEqual([...always, 'image'].toSorted())
    expect(running(['examples/deployment/time-series/compose.yaml'])).toEqual([...always, 'image'].toSorted())
    expect(running(['electron/main.ts'])).toEqual([...always, 'desktop-e2e'].toSorted())
    expect(running(['test/e2e/web/apps.spec.ts'])).toEqual([...always, 'e2e-web'].toSorted())
    expect(running(['packages/studio-sdk/src/index.ts'])).toEqual([...always, 'desktop-e2e', 'e2e-web', 'integration', 'packages'].toSorted())
  })

  it('names the file and pattern that ran a job', () => {
    const result = plan({ event: 'pull_request', files: ['README.md', 'docker/start.mjs'] })
    expect(result.image).toEqual({ run: true, reason: 'docker/start.mjs (docker/**)' })
    expect(result['e2e-web']).toEqual({ run: false, reason: 'no changed file matches its paths' })
  })
})

describe('CI verdict', () => {
  const planned = { 'build': true, 'image': false, 'e2e-web': true }

  it('passes when every job succeeded or was skipped by plan', () => {
    expect(verdict({ planned, needs: { 'build': { result: 'success' }, 'image': { result: 'skipped' }, 'e2e-web': { result: 'success' } } })).toEqual([])
  })

  it('fails for failed, cancelled and unplanned skipped jobs', () => {
    expect(verdict({ planned, needs: { 'build': { result: 'failure' }, 'image': { result: 'cancelled' }, 'e2e-web': { result: 'skipped' } } })).toEqual([
      'build: failure',
      'image: cancelled',
      'e2e-web: skipped although the plan ran it',
    ])
  })

  it('fails every skipped job without a plan', () => {
    expect(verdict({ planned: null, needs: { changes: { result: 'failure' }, image: { result: 'skipped' } } })).toEqual(['changes: failure', 'image: skipped although the plan ran it'])
  })
})
