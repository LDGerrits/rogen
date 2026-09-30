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

// The files other modules of a layer may import; everything else in a module is internal.
const modules = {
	domain: {
		build: ["build-service"],
		config: ["config", "config-service"],
		init: ["init-service"],
		roblox: ["roblox", "services"],
		rojo: ["rojo-file", "rojo-project"],
		toolchain: ["toolchain", "toolchain-service"],
		watch: ["watch-service"],
	},
	// A command's own file is imported only by the composition root, for its side effect.
	commands: {
		build: ["build-log"],
		config: ["config-command"],
		help: [],
		init: [],
		list: [],
		version: [],
		watch: [],
		where: [],
	},
};

// Every file of these layers sits in a module, and every module lists its public files.
for (const [layer, layerModules] of Object.entries(modules)) {
	for (const entry of readdirSync(`src/${layer}`, { withFileTypes: true })) {
		if (entry.isFile()) {
			throw new Error(
				`Move src/${layer}/${entry.name} into a module: a file at the root of ${layer} belongs to no feature.`
			);
		}
		if (
			entry.isDirectory() &&
			entry.name !== "__tests__" &&
			!(entry.name in layerModules)
		) {
			throw new Error(
				`Add the public files of src/${layer}/${entry.name} to modules.${layer} in eslint.config.js.`
			);
		}
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

// From a file `depth` folders below its layer: other modules of the layer, and domain modules from commands, only through their public files.
const internalsPatterns = (layer, module, depth) => [
	...Object.entries(modules[layer])
		.filter(([name]) => name !== module)
		.map(([name, files]) => ({
			regex: `${up(depth)}${name}/${publicFiles(files)}`,
			message: `Import ${name} through its public files.`,
		})),
	...(layer === "commands"
		? Object.entries(modules.domain).map(([name, files]) => ({
				regex: `${up(depth + 1)}domain/${name}/${publicFiles(files)}`,
				message: `Import ${name} through its public files.`,
			}))
		: []),
];

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
	(layer === "base" ? [0, 1, 2, 3] : [1, 2, 3]).flatMap((depth) => {
		const patterns = layerPatterns(layer, depth);
		const rule = (list) => ({
			"no-restricted-imports": ["error", { patterns: list }],
		});
		const internals = (module) => ({
			files: [`src/${layer}/${module}/${folders(depth - 1)}*.ts`],
			ignores: ["**/__tests__/**"],
			rules: rule([
				...patterns,
				...internalsPatterns(layer, module, depth),
				platformImplementationPattern,
			]),
		});
		// A contract must not depend on what it hides.
		const publicOnly = (module) => ({
			files: modules[layer][module].map(
				(file) => `src/${layer}/${module}/${file}.ts`
			),
			rules: rule([
				...patterns,
				...internalsPatterns(layer, module, depth),
				platformImplementationPattern,
				{
					regex: `^\\./(?!(${modules[layer][module].join("|")})\\.js$)`,
					message: `A public file of ${module} imports only its other public files.`,
				},
			]),
		});
		return [
			{
				files: [`src/${layer}/${folders(depth)}*.ts`],
				rules: rule(patterns),
			},
			...Object.keys(modules[layer] ?? {}).flatMap((module) => [
				internals(module),
				...(depth === 1 && modules[layer][module].length > 0
					? [publicOnly(module)]
					: []),
			]),
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
