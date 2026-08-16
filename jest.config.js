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
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	testMatch: ["<rootDir>/src/**/__tests__/**/*.test.ts"],
};
