const packageJson = require('./package');

const { env } = packageJson.betterScripts.test;
const { files: tests } = packageJson.ava;

const envString = Object.entries(env)
  .map(([key, value]) => `${key}=${value}`)
  .join(';');

module.exports = () => ({
  files: [
    'knexfile.js',
    'src/**/*.js',
    'data/**/*.*',
    'src/**/*.html',
    'tests/__data/**/*.*',
    'tests/helpers/**/*.js',
  ],
  tests,
  env: {
    type: 'node',
    params: {
      env: envString,
    },
  },
  debug: true,
  testFramework: 'ava',
});
