import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { changedFiles, globToRegExp, jobs, plan, verdict } from '../../scripts/ci-changes.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))

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
    expect(running(['app/components/WelcomeScreen.vue'])).toEqual([...always, 'desktop-build', 'desktop-e2e', 'e2e-web', 'integration'].toSorted())
  })

  it('runs the narrow jobs for their paths', () => {
    expect(running(['server/lib/containers/manager.ts'])).toContain('containers')
    expect(running(['docker/start.mjs'])).toEqual([...always, 'image'].toSorted())
    expect(running(['examples/deployment/time-series/compose.yaml'])).toEqual([...always, 'image'].toSorted())
    expect(running(['electron/main.ts'])).toEqual([...always, 'desktop-build', 'desktop-e2e'].toSorted())
    expect(running(['test/e2e/web/apps.spec.ts'])).toEqual([...always, 'e2e-web'].toSorted())
    expect(running(['packages/studio-sdk/src/index.ts'])).toEqual([...always, 'desktop-build', 'desktop-e2e', 'e2e-web', 'integration', 'packages'].toSorted())
  })

  it('runs the integration tests for unit tests with PostgreSQL cases', () => {
    expect(running(['test/database/migrate.test.ts'])).toEqual([...always, 'integration'].toSorted())
    expect(running(['test/apps/updates.test.ts'])).toContain('integration')
  })

  it('runs the integration tests for every test file that uses the test environment', () => {
    const files = readdirSync(join(root, 'test'), { recursive: true, encoding: 'utf8' })
      .filter(file => file.endsWith('.test.ts') && /from '(?:\.\.\/)+support\/testenv'/.test(readFileSync(join(root, 'test', file), 'utf8')))
      .map(file => relative(root, join(root, 'test', file)).split('\\').join('/'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      expect(plan({ event: 'pull_request', files: [file] }).integration, file).toMatchObject({ run: true })
    }
  })

  it('names the file and pattern that ran a job', () => {
    const result = plan({ event: 'pull_request', files: ['README.md', 'docker/start.mjs'] })
    expect(result.image).toEqual({ run: true, reason: 'docker/start.mjs (docker/**)' })
    expect(result['e2e-web']).toEqual({ run: false, reason: 'no changed file matches its paths' })
  })
})

describe('CI changed files', () => {
  /** A repository whose HEAD merges a branch into main, as a pull request run checks it out. */
  function mergedPullRequest (change: (git: (...args: string[]) => string, directory: string) => void): string {
    const directory = mkdtempSync(join(tmpdir(), 'studio-ci-changes-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' })
    git('init', '--quiet', '--initial-branch=main')
    git('config', 'user.email', 'ci@example.org')
    git('config', 'user.name', 'CI')
    mkdirSync(join(directory, 'test/integration'), { recursive: true })
    writeFileSync(join(directory, 'test/integration/target.test.ts'), 'export const value = 1\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'base')
    git('checkout', '--quiet', '-b', 'change')
    change(git, directory)
    git('commit', '--quiet', '-m', 'change')
    git('checkout', '--quiet', 'main')
    git('merge', '--quiet', '--no-ff', '-m', 'merge', 'change')
    return directory
  }

  it('lists a moved file at both paths, so leaving a job\'s paths still runs it', () => {
    const directory = mergedPullRequest((git, cwd) => {
      mkdirSync(join(cwd, 'scratch'))
      git('mv', 'test/integration/target.test.ts', 'scratch/target.test.ts')
    })
    try {
      expect(changedFiles(directory)?.toSorted()).toEqual(['scratch/target.test.ts', 'test/integration/target.test.ts'])
      expect(plan({ event: 'pull_request', files: changedFiles(directory) }).integration.run).toBe(true)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('knows no files outside a merge commit', () => {
    const directory = mergedPullRequest((git, cwd) => {
      writeFileSync(join(cwd, 'README.md'), 'Changed\n')
      git('add', 'README.md')
    })
    try {
      execFileSync('git', ['checkout', '--quiet', 'HEAD^1'], { cwd: directory })
      expect(changedFiles(directory)).toBeUndefined()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
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
