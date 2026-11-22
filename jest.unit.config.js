import base from "./jest.config.js";

// A config file instead of `--roots`, which would swallow a path given after
// it.
export default {
	...base,
	testMatch: [
		"<rootDir>/src/**/__tests__/**/*.test.ts",
		"<rootDir>/scripts/**/__tests__/**/*.test.ts",
	],
	coverageThreshold: {
		global: { statements: 100, branches: 100, functions: 100, lines: 100 },
	},
};
