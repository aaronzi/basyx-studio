import vuetify from 'eslint-config-vuetify'
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  vuetify({
    ts: true,
  }),
).append({
  ignores: ['dist-electron/**'],
}).append({
  // The local test environment is plain HTTP on loopback by design; the
  // autofix of this rule would silently break its URLs.
  files: ['test/**', 'test-setup/**'],
  rules: {
    'unicorn/prefer-https': 'off',
  },
}).append({
  // Drizzle's query builder uses `.values(...)`, which this rule mistakes for
  // Array.prototype.values().
  files: ['server/**', 'test/**'],
  rules: {
    'unicorn/no-unused-array-method-return': 'off',
  },
}).append({
  // A JavaScript comment-style rule that misreads YAML `#` comments.
  files: ['pnpm-workspace.yaml'],
  rules: {
    '@stylistic/spaced-comment': 'off',
  },
})
