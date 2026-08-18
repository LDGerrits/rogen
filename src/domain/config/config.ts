import { z } from "zod";
import path from "path";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RojoTree } from "../rojo/rojo-project.js";
import { Result, ok, err } from "../../base/result.js";
import { ErrorUtils } from "../../base/errors.js";
import { mergeDeep } from "../../base/object.js";

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

export async function parseConfig(
	rawConfig: Record<string, unknown>,
	configDir: string,
	fs: FileSystemService
): Promise<Result<ResolvedConfig, Error>> {
	const configCopy = { ...rawConfig };

	if (typeof configCopy.template === "string") {
		const templatePath = path.resolve(configDir, configCopy.template);

		if (!(await fs.exists(templatePath))) {
			return err(
				new Error(`Specified template file not found: ${templatePath}`)
			);
		}

		try {
			const templateContent = await fs.readFile(templatePath);
			configCopy.template = JSON.parse(templateContent);
		} catch (error) {
			return err(
				new Error(
					`Failed to parse template JSON: ${ErrorUtils.fromUnknown(error).message}`
				)
			);
		}
	}

	const configWithDefaults = mergeDeep<Record<string, unknown>>(
		defaultConfig as Record<string, unknown>,
		configCopy
	);

	const parseResult = ConfigSchema.safeParse(configWithDefaults);

	if (!parseResult.success) {
		const issues = parseResult.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join(", ");
		return err(new Error(`Configuration validation failed: ${issues}`));
	}

	return ok(parseResult.data);
}
