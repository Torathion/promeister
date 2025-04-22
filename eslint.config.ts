import shiny from 'eslint-config-shiny'

export default [
  ...(await shiny({ configs: ['base', 'format', 'vitest'] })),
  {
    rules: {
      'no-underscore-dangle': 0,
      'no-promise-executor-return': 0,
      'promise/catch-or-return': 0,
      'promise/prefer-await-to-then': 0,
      'unicorn/no-thenable': 0
    }
  }
]
