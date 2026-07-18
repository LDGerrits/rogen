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
	setupFilesAfterEnv: ["<rootDir>/test/setup.ts"],
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	testMatch: [
		"<rootDir>/test/**/*.test.ts",
		"<rootDir>/src/**/test/**/*.test.ts",
	],
};
