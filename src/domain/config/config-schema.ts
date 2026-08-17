import { z } from "zod";
import { RojoTree } from "../rojo/rojo-project.js";

const ModeSchema = z.object({
	output: z.string(),
	build: z.string(),
	env: z.array(z.string()).default([]),
	globIgnorePaths: z.array(z.string()).default([]),
});

const RojoProjectSchema = z.custom<RojoTree>((val) => {
	if (typeof val !== "object" || val === null || Array.isArray(val))
		return false;
	const record = val as Record<string, unknown>;
	return (
		typeof record.name === "string" &&
		typeof record.tree === "object" &&
		record.tree !== null
	);
}, "Invalid Rojo Project");

const BaseConfigSchema = z.object({
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
	template: z.union([z.string(), RojoProjectSchema]).optional(),
});

export const ConfigSchema = BaseConfigSchema.catchall(z.unknown()).superRefine(
	(data, ctx) => {
		for (const [key, value] of Object.entries(data)) {
			if (!(key in BaseConfigSchema.shape)) {
				const modeResult = ModeSchema.safeParse(value);
				if (!modeResult.success) {
					ctx.addIssue({
						code: "custom",
						message: `Custom mode "${key}" is missing a valid "output" or "build" string.`,
						path: [key],
					});
				}
			}
		}
	}
);

export type ResolvedConfig = z.infer<typeof ConfigSchema>;
export type Mode = z.infer<typeof ModeSchema>;

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
