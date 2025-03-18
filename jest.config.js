/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+.tsx?$": ["ts-jest", {}],
  },
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  preset: "ts-jest",
  collectCoverage: true,
  collectCoverageFrom: ["<rootDir>/**/*.ts"],
};
