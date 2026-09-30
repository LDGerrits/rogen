import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import jestPlugin from "eslint-plugin-jest";
import { defineConfig } from "eslint/config";
import { readdirSync } from "node:fs";

// What each layer must not import.
const layersAbove = {
	base: ["platform", "domain", "commands"],
	platform: ["domain", "commands"],
	domain: ["commands"],
	commands: [],
};

// The files other modules may import; everything else in a domain module is internal.
const domainModules = {
	build: ["build-service"],
	config: ["config", "config-service"],
	init: ["init-directory", "init-service"],
	roblox: ["roblox"],
	rojo: ["rojo-file", "rojo-project"],
	toolchain: ["toolchain", "toolchain-service"],
	watch: ["watch-service", "watch-session"],
};

for (const entry of readdirSync("src/domain", { withFileTypes: true })) {
	if (entry.isDirectory() && !(entry.name in domainModules)) {
		throw new Error(
			`Add the public files of src/domain/${entry.name} to domainModules.`
		);
	}
}

const up = (count) => `^(\\.\\./){${count}}`;
const publicFiles = (files) => `(?!(${files.join("|")})\\.js$)`;

// A file `depth` folders below its layer reaches src/ with depth + 1 `../`.
const layerPatterns = (layer, depth) => [
	...(layersAbove[layer].length > 0
		? [
				{
					regex: `${up(depth + 1)}(${layersAbove[layer].join("|")})/`,
					message: `${layer} cannot depend on a layer above it.`,
				},
			]
		: []),
	{
		regex: `${up(depth + 1)}main\\.js$`,
		message: "Only the composition root imports main.",
	},
];

const internalsPatterns = (layer, module, depth) =>
	Object.entries(domainModules)
		.filter(([name]) => name !== module)
		.map(([name, files]) => ({
			regex:
				layer === "domain"
					? `${up(depth)}${name}/${publicFiles(files)}`
					: `${up(depth + 1)}domain/${name}/${publicFiles(files)}`,
			message: `Import ${name} through its public files.`,
		}));

// Platform contract files are ports; the files named for how they fulfil one are the outermost ring (ADR-0009).
const IMPLEMENTATION_PREFIXES = [
	"core",
	"console",
	"disk",
	"memory",
	"native",
	"plain",
	"terminal",
];

const platformImplementationPattern = {
	regex: `(^|/)platform/[^/]+/(${IMPLEMENTATION_PREFIXES.join("|")})-[^/]*\\.js$`,
	message:
		"Domain and commands depend on platform contract files, never on an implementation. Only main.ts and tests name one.",
};

const folders = (depth) => "*/".repeat(depth);

const layerConfigs = Object.keys(layersAbove).flatMap((layer) =>
	(layer === "base" || layer === "commands"
		? [0, 1, 2, 3]
		: [1, 2, 3]
	).flatMap((depth) => {
		const patterns = layerPatterns(layer, depth);
		const rule = (list) => ({
			"no-restricted-imports": ["error", { patterns: list }],
		});
		const internals = (files, module) => ({
			files,
			ignores: ["**/__tests__/**"],
			rules: rule([
				...patterns,
				...internalsPatterns(layer, module, depth),
				platformImplementationPattern,
			]),
		});
		return [
			{
				files: [`src/${layer}/${folders(depth)}*.ts`],
				rules: rule(patterns),
			},
			...(layer === "domain"
				? Object.keys(domainModules).map((module) =>
						internals(
							[`src/domain/${module}/${folders(depth - 1)}*.ts`],
							module
						)
					)
				: layer === "commands"
					? [internals([`src/commands/${folders(depth)}*.ts`])]
					: []),
		];
	})
);

export default defineConfig(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		ignores: ["dist/", "node_modules/", "docs/"],
	},
	{
		files: ["src/**/*.ts", "src/**/*.js"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaVersion: "latest",
				sourceType: "module",
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "warn",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
		},
	},
	...layerConfigs,
	{
		files: ["src/**/*.test.ts", "e2e/**/*.test.ts", "tests/**/*.spec.ts"],
		...jestPlugin.configs["flat/recommended"],
		languageOptions: {
			parser: tseslint.parser,
		},
		rules: {
			...jestPlugin.configs["flat/recommended"].rules,
		},
	}
);
