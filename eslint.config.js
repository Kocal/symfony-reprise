import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    ignores: [
      // playground/ is a fixture Symfony app (vendored + generated files); not library source.
      'playground/**',
      // assets/test/fixtures/ holds sample app code built by integration tests; not library source.
      'assets/test/fixtures/**',
      // docs/ holds design specs + implementation plans; their fenced code blocks are illustrative, not source.
      'docs/**',
      // vendor/ is Composer's PHP dependencies.
      'vendor/**',
    ],
  },
  {
    // Code blocks inside markdown are linted as virtual files named `<file>.md/<n>.ts`,
    // so target that glob, not the .md file itself.
    files: ['**/README.md/**'],
    rules: {
      'perfectionist/sort-imports': 'off',
    },
  },
  {
    // antfu 9's pnpm/yaml-enforce-settings imposes opinionated pnpm-workspace settings
    // (shellEmulator, trustPolicy). Leave those to the maintainer's choice.
    rules: {
      'pnpm/yaml-enforce-settings': 'off',
    },
  },
)
