import os from "os";

const JEST_DEFAULT_MAX_CONCURRENCY = 5;

export default {
	preset: "ts-jest/presets/default-esm",
	testEnvironment: "node",
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},
	transform: {
		"^.+\\.tsx?$": [
			"ts-jest",
			{
				useESM: true,
			},
		],
	},
	maxConcurrency: Math.max(
		JEST_DEFAULT_MAX_CONCURRENCY,
		os.availableParallelism()
	),
	setupFilesAfterEnv: ["<rootDir>/jest.paths.js"],
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	collectCoverageFrom: ["src/**/*.ts", "!src/**/__tests__/**"],
	coverageReporters: ["text-summary", "json-summary"],
	testMatch: [
		"<rootDir>/src/**/__tests__/**/*.test.ts",
		"<rootDir>/scripts/**/__tests__/**/*.test.ts",
		"<rootDir>/e2e/*.test.ts",
	],
};
