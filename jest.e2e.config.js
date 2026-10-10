import base from "./jest.config.js";

export default {
	...base,
	testMatch: ["<rootDir>/e2e/*.test.ts"],
};
