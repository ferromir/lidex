import type { Config } from "jest";

export default async (): Promise<Config> => {
  return {
    testEnvironment: "node",
    transform: {
      "^.+.tsx?$": ["ts-jest", {}],
    },
    modulePathIgnorePatterns: ["<rootDir>/dist/", "jest.config.ts"],
    preset: "ts-jest",
    collectCoverage: true,
    collectCoverageFrom: ["<rootDir>/**/*.ts"],
    // coverageThreshold: {
    //   global: {
    //     branches: 100,
    //     functions: 100,
    //     lines: 100,
    //     statements: 100,
    //   },
    // },
  };
};
