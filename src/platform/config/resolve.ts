import path from "path";
import { createToolchainProvider } from "./providers/toolchain.js";
import { createFileProvider } from "./providers/file.js";
import { createCliProvider } from "./providers/cli.js";
import { IFileSystem } from "../fs/file-system.js";
import { err, Result } from "../../base/result.js";
import { WorkspaceContext, validateConfig } from "./validate.js";
import { DEFAULT_CONFIG, ResolvedConfig, UserConfig } from "./config.js";
import { CliArgs } from "../cli/args.js";
import { mergeDeep } from "../../base/object.js";

export async function resolveConfig(
	fs: IFileSystem,
	cliArgs: CliArgs,
	cwd: string
): Promise<Result<ResolvedConfig, Error>> {
	const configPath = cliArgs.config
		? path.resolve(cwd, cliArgs.config)
		: undefined;

	const ctx: WorkspaceContext = { cwd, configPath };

	const providers = [
		createToolchainProvider(fs),
		createFileProvider(fs),
		createCliProvider(cliArgs),
	];

	// Merge UserConfigs
	let mergedUserConfig: UserConfig = structuredClone(DEFAULT_CONFIG);

	for (const provider of providers) {
		const result = await provider(ctx);

		if (result.isErr()) return err(result.error);

		mergedUserConfig = mergeDeep(mergedUserConfig, result.unwrap());
	}

	// Normalize
	if (typeof mergedUserConfig.template === "string") {
		const templateExists = await fs.exists(mergedUserConfig.template);
		if (!templateExists) {
			return err(
				new Error(
					`Specified template file not found: ${mergedUserConfig.template}`
				)
			);
		}
		try {
			const templateContent = await fs.readFile(
				mergedUserConfig.template
			);
			mergedUserConfig.template = JSON.parse(templateContent);
		} catch (error) {
			const errMsg =
				error instanceof Error ? error.message : String(error);
			return err(
				new Error(
					`Failed to parse Rojo Project JSON file template: ${errMsg}`
				)
			);
		}
	}

	let normalizedSource = [...DEFAULT_CONFIG.source];
	if (mergedUserConfig.source) {
		normalizedSource = Array.isArray(mergedUserConfig.source)
			? mergedUserConfig.source
			: [mergedUserConfig.source];
	}

	// Finalize
	const finalConfig: Record<string, unknown> = {
		...mergedUserConfig,
		source: normalizedSource,
		template: mergedUserConfig.template,
		casing: mergedUserConfig.casing,
		verbatim: mergedUserConfig.verbatim,
		unwrap: mergedUserConfig.unwrap,
		aliases: mergedUserConfig.aliases,
		globIgnorePaths: mergedUserConfig.globIgnorePaths,
	};

	return validateConfig(finalConfig);
}
