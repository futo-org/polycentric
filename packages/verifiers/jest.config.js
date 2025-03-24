const merge = require('merge')
const ts_preset = require('ts-jest/jest-preset')

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = merge.recursive(ts_preset, {
  testEnvironment: 'node',
  testPathIgnorePatterns: ["dep"],
  runner: "groups"
});
