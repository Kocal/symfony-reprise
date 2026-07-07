import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  // playground/ is a fixture Symfony app (vendored + generated files); not library source.
  ignores: ['playground/**'],
})
