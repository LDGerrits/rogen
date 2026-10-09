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
	// e2e cases wait on child processes, so more of them can run at once than there are cores.
	maxConcurrency: 15,
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	testMatch: [
		"<rootDir>/src/**/__tests__/**/*.test.ts",
		"<rootDir>/scripts/**/__tests__/**/*.test.ts",
		"<rootDir>/e2e/*.test.ts",
	],
};
