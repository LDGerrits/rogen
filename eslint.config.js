import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import jestPlugin from "eslint-plugin-jest";
import { defineConfig } from "eslint/config";

export default defineConfig(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		ignores: ["dist/", "examples/", "node_modules/"],
	},
	{
		files: ["src/**/*.ts", "src/**/*.js"],
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_" },
			],
		},
	},
	{
		files: ["src/**/*.test.ts", "tests/**/*.spec.ts"],
		...jestPlugin.configs["flat/recommended"],
		rules: {
			...jestPlugin.configs["flat/recommended"].rules,
		},
	}
);
