import base from "./jest.config.js";

// The tests that need no bundle and no Rojo. A config file instead of `--roots`, which would swallow a path given after it.
export default {
	...base,
	testMatch: [
		"<rootDir>/src/**/__tests__/**/*.test.ts",
		"<rootDir>/scripts/**/__tests__/**/*.test.ts",
	],
};
