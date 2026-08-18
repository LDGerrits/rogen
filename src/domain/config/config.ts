import { z } from "zod";
import { RojoTree } from "../rojo/rojo-project.js";

export const ModeSchema = z.object({
	output: z.string(),
	build: z.string(),
	env: z.array(z.string()).default([]),
	globIgnorePaths: z.array(z.string()).default([]),
});

export const CoreConfigSchema = z.object({
	source: z
		.union([z.string(), z.array(z.string())])
		.transform((val) => (Array.isArray(val) ? val : [val]))
		.default(["src"]),
	verbatim: z.boolean().default(false),
	unwrap: z.boolean().default(false),
	casing: z
		.enum(["camelCase", "PascalCase", "camel", "pascal"])
		.transform((val) =>
			val === "camel"
				? "camelCase"
				: val === "pascal"
					? "PascalCase"
					: val
		)
		.default("camelCase"),
	aliases: z.record(z.string(), z.string()).default({}),
	globIgnorePaths: z.array(z.string()).default([]),
	luau: ModeSchema.optional(),
	ts: ModeSchema.optional(),
	darklua: ModeSchema.optional(),
	template: z.any().optional(),
});

export type Mode = z.infer<typeof ModeSchema>;
export type ResolvedConfig = z.infer<typeof CoreConfigSchema> &
	Record<string, unknown>;

export const defaultTemplate: RojoTree = {
	name: "roblox-game",
	tree: { $className: "DataModel" },
};

export const defaultConfig: ResolvedConfig = {
	source: ["src"],
	globIgnorePaths: [],
	aliases: {},
	unwrap: false,
	verbatim: false,
	casing: "camelCase",
	luau: {
		output: "default.project.json",
		build: "src",
		env: [],
		globIgnorePaths: [],
	},
	ts: {
		output: "default.project.json",
		build: "out",
		env: [],
		globIgnorePaths: [],
	},
	darklua: {
		output: "build.project.json",
		build: "dist",
		env: [],
		globIgnorePaths: [],
	},
	template: defaultTemplate,
};
