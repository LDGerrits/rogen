import os from "os";

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
	// e2e cases mostly wait on child processes; one per core, and never fewer than Jest's default.
	maxConcurrency: Math.max(5, os.availableParallelism()),
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	testMatch: [
		"<rootDir>/src/**/__tests__/**/*.test.ts",
		"<rootDir>/scripts/**/__tests__/**/*.test.ts",
		"<rootDir>/e2e/*.test.ts",
	],
};
