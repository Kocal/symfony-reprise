import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    ignores: [
      // playground/ is a fixture Symfony app (vendored + generated files); not library source.
      'playground/**',
      // test/fixtures/ holds sample app code built by integration tests; not library source.
      'test/fixtures/**',
      // docs/ holds design specs + implementation plans; their fenced code blocks are illustrative, not source.
      'docs/**',
    ],
  },
  {
    // antfu 9's pnpm/yaml-enforce-settings imposes opinionated pnpm-workspace settings
    // (shellEmulator, trustPolicy). Leave those to the maintainer's choice.
    rules: {
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
)
