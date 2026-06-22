/** Jest config for the standalone AgentWA plugin. Run from the repo root:
 *   npx jest -c agentwa-plugin/jest.config.cjs
 * (jest + ts-jest are resolved from the parent OpenWA repo's node_modules.) */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', esModuleInterop: true, target: 'ES2022' } }],
  },
};
