// Decides which CI jobs a pull request runs, from the files it changes, and
// checks the outcome at the end of the run (docs/development/ci.md):
//   node scripts/ci-changes.mjs plan      in the `changes` job
//   node scripts/ci-changes.mjs verdict   in the `ci-result` job
// The same changed files always give the same jobs. Pushes to main, the
// nightly run, a manual run and the `ci:full` label run every job.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

/** Files that never affect a job; the workflow does not start for them alone. */
export const ignored = ['docs/**', '**/*.md']

/**
 * A change to any of these runs every job: every file at the repository
 * root (package.json, pnpm-lock.yaml, nuxt.config.ts, Dockerfile, …), the
 * patched dependencies and CI itself.
 */
export const everything = ['*', 'patches/**', '.github/workflows/ci.yml', '.github/actions/**', '.github/scripts/**', 'scripts/ci-changes.mjs']

/** The code of Studio and of its bundled apps. */
const studio = ['app/**', 'server/**', 'shared/**', 'apps/**', 'packages/**', 'i18n/**', 'modules/**', 'public/**', 'scripts/build-example-apps.mjs']

/** The desktop app and its tests. */
const desktop = [...studio, 'electron/**', 'build/**', 'test/e2e/desktop/**', 'test/e2e/desktop.config.ts', 'test/apps/**', 'test-setup/fixtures/**', 'examples/apps/**']

/** Each job runs always, or when a changed file matches one of its paths. */
export const jobs = {
  'lint': 'always',
  'typecheck': 'always',
  'unit': 'always',
  'build': 'always',
  // With the PostgreSQL cases of unit tests that use the test environment
  // (test/support/testenv.ts); test/ci/changes.test.ts finds them all.
  'integration': [...studio, 'test/integration/**', 'test/support/**', 'test-setup/**', 'test/database/migrate.test.ts', 'test/apps/updates.test.ts'],
  'e2e-web': [...studio, 'test/e2e/web/**', 'test/e2e/origins/**', 'test/e2e/web.config.ts', 'test/e2e/origins.config.ts', 'test/apps/**', 'test-setup/**', 'examples/apps/**'],
  'desktop-build': desktop,
  'desktop-e2e': desktop,
  // Real BaSyx stacks on the container engine (ADR 0033).
  'containers': ['server/lib/containers/**', 'server/lib/desktop/**', 'server/database/**', 'test/integration/containers.test.ts', 'test-setup/fixtures/open/**'],
  // The image and the deployment examples: packaging, start-up and the
  // server parts the examples exercise; Studio's behaviour is e2e-web's.
  'image': ['docker/**', 'examples/deployment/**', 'modules/**', 'server/nitro/**', 'server/plugins/**', 'server/database/**', 'server/lib/config.ts', 'server/lib/urls.ts', 'server/lib/infrastructure-file.ts', 'server/lib/apps/**', 'server/lib/connections/**', 'server/lib/timeseries/**', 'apps/time-series/**'],
  'packages': ['packages/**', 'examples/apps/**', 'scripts/build-example-apps.mjs', 'scripts/build-package.mjs', 'scripts/check-app-tarballs.mjs'],
}

/** The label that runs every job on a pull request. */
export const fullLabel = 'ci:full'

/** `**` spans folders, `*` stays within one; a pattern matches the whole path. */
export function globToRegExp (pattern) {
  let source = ''
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*') {
      const slash = pattern[index + 2] === '/'
      source += slash ? '(?:.*/)?' : '.*'
      index += slash ? 2 : 1
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, String.raw`\$&`)
    }
  }
  return new RegExp(`^${source}$`)
}

function firstMatch (files, patterns) {
  for (const file of files) {
    const pattern = patterns.find(candidate => globToRegExp(candidate).test(file))
    if (pattern) {
      return { file, pattern }
    }
  }
  return undefined
}

/**
 * The jobs to run. `files` is undefined when the changed files are unknown.
 * Each job comes with the reason, for the job summary.
 */
export function plan ({ event, labels = [], files }) {
  const all = reason => Object.fromEntries(Object.keys(jobs).map(job => [job, { run: true, reason }]))
  if (event !== 'pull_request') {
    return all(`a ${event} run runs every job`)
  }
  if (labels.includes(fullLabel)) {
    return all(`the label ${fullLabel} runs every job`)
  }
  if (files === undefined) {
    return all('the changed files are unknown, so every job runs')
  }
  const relevant = files.filter(file => !ignored.some(pattern => globToRegExp(pattern).test(file)))
  const global = firstMatch(relevant, everything)
  if (global) {
    return all(`${global.file} (${global.pattern}) runs every job`)
  }
  return Object.fromEntries(Object.entries(jobs).map(([job, paths]) => {
    if (paths === 'always') {
      return [job, { run: true, reason: 'runs on every pull request' }]
    }
    const match = firstMatch(relevant, paths)
    return [job, match ? { run: true, reason: `${match.file} (${match.pattern})` } : { run: false, reason: 'no changed file matches its paths' }]
  }))
}

/**
 * Problems with the outcome of the run: a job that failed or was cancelled,
 * or one that was skipped although the plan ran it. `needs` is the
 * workflow's `needs` context.
 */
export function verdict ({ needs, planned }) {
  const problems = []
  for (const [job, { result }] of Object.entries(needs)) {
    if (result === 'success') {
      continue
    }
    if (result === 'skipped' && planned?.[job] === false) {
      continue
    }
    problems.push(`${job}: ${result}${result === 'skipped' ? ' although the plan ran it' : ''}`)
  }
  return problems
}

/** The files a pull request changes, or undefined when they are unknown. */
export function changedFiles (cwd = process.cwd()) {
  try {
    // A pull request run checks out the merge commit: its first parent is
    // the base branch, so the diff is what merging would change.
    const parents = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd, encoding: 'utf8' }).trim().split(' ')
    if (parents.length !== 3) {
      return undefined
    }
    // Without rename detection, a moved file counts at its old path as well,
    // so moving it out of a job's paths still runs that job.
    return execFileSync('git', ['diff', '--name-only', '--no-renames', 'HEAD^1', 'HEAD'], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return undefined
  }
}

function pullRequestLabels () {
  // Read now, not from the event, so that a re-run sees a label added since.
  const number = process.env.PR_NUMBER
  if (!number) {
    return []
  }
  try {
    return execFileSync('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/issues/${number}/labels`, '--jq', '.[].name'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    // Unknown labels run every job, as unknown files do.
    return [fullLabel]
  }
}

function summary (lines) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
  }
  console.info(lines.join('\n'))
}

function runPlan () {
  const event = process.env.GITHUB_EVENT_NAME ?? 'pull_request'
  const files = event === 'pull_request' ? changedFiles() : undefined
  const result = plan({ event, labels: event === 'pull_request' ? pullRequestLabels() : [], files })
  const planned = Object.fromEntries(Object.entries(result).map(([job, { run }]) => [job, run]))
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${Object.entries(planned).map(([job, run]) => `${job}=${run}`).join('\n')}\nplan=${JSON.stringify(planned)}\n`)
  }
  summary([
    '### Jobs of this run',
    '',
    `${files === undefined ? 'Changed files: unknown' : `Changed files: ${files.length}`} (rules: \`scripts/ci-changes.mjs\`)`,
    '',
    '| Job | Runs | Why |',
    '| --- | --- | --- |',
    ...Object.entries(result).map(([job, { run, reason }]) => `| ${job} | ${run ? 'yes' : 'no'} | ${reason} |`),
  ])
}

function runVerdict () {
  const problems = verdict({ needs: JSON.parse(process.env.NEEDS ?? '{}'), planned: JSON.parse(process.env.PLAN || 'null') })
  if (problems.length > 0) {
    summary(['### CI failed', '', ...problems.map(problem => `- ${problem}`)])
    process.exitCode = 1
    return
  }
  summary(['### CI passed', '', 'Every job that the plan ran succeeded.'])
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const command = process.argv[2]
  if (command === 'plan') {
    runPlan()
  } else if (command === 'verdict') {
    runVerdict()
  } else {
    console.error('Usage: node scripts/ci-changes.mjs plan|verdict')
    process.exitCode = 2
  }
}
