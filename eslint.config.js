import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  ignores: [
    // playground/ is a fixture Symfony app (vendored + generated files); not library source.
    'playground/**',
    // test/fixtures/ holds sample app code built by integration tests; not library source.
    'test/fixtures/**',
  ],
})
