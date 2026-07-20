import { z } from "zod";
import { RojoTree } from "../rojo/tree.js";

const ModeSchema = z.object({
	output: z.string(),
	build: z.string(),
	env: z.array(z.string()).default([]),
	globIgnorePaths: z.array(z.string()).default([]),
});

const ToolchainProfileSchema = z.object({
	isTs: z.boolean().default(false),
	isWally: z.boolean().default(false),
	isPesde: z.boolean().default(false),
	isDarklua: z.boolean().default(false),
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

const CORE_KEYS = new Set([
	"source",
	"verbatim",
	"unwrap",
	"casing",
	"aliases",
	"globIgnorePaths",
	"luau",
	"ts",
	"darklua",
	"template",
	"toolchain",
	"keepRouteNames",
	"keepSuffixes",
]);

export const ConfigSchema = z
	.object({
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
		toolchain: ToolchainProfileSchema.optional(),
		// Legacy keys
		keepRouteNames: z.unknown().optional(),
		keepSuffixes: z.unknown().optional(),
	})
	// Custom modes
	.catchall(z.unknown())
	.superRefine((data, ctx) => {
		if (data.keepRouteNames !== undefined) {
			ctx.addIssue({
				code: "custom",
				message:
					'The key "keepRouteNames" has been renamed to "verbatim". Please update your configuration.',
				path: ["keepRouteNames"],
			});
		}

		if (data.keepSuffixes !== undefined) {
			ctx.addIssue({
				code: "custom",
				message:
					'The key "keepSuffixes" has been renamed to "verbatim". Please update your configuration.',
				path: ["keepSuffixes"],
			});
		}

		for (const [key, value] of Object.entries(data)) {
			if (!CORE_KEYS.has(key)) {
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
	});

export type ResolvedConfig = z.infer<typeof ConfigSchema>;
export type Mode = z.infer<typeof ModeSchema>;
