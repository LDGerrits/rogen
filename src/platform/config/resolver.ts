import { IFileSystem } from "../fs/file-system.js";
import { err, Result } from "../../base/result.js";
import { DEFAULT_CONFIG, ResolvedConfig, UserConfig } from "./config.js";
import { mergeDeep } from "../../base/object.js";
import { IConfigProvider, WorkspaceContext } from "./providers/provider.js";
import { ConfigValidator } from "./validator.js";
import { LegacyKeyRule } from "./rules/legacy-key.js";
import { CustomModeRule } from "./rules/custom-mode.js";
import { EnforceTypeRule } from "./rules/enforce-type.js";
import { UnknownKeyRule } from "./rules/unknown-key.js";

export class ConfigBuilder {
	private providers: IConfigProvider[] = [];

	addProvider(provider: IConfigProvider): this {
		this.providers.push(provider);
		return this;
	}

	async build(
		fs: IFileSystem,
		ctx: WorkspaceContext
	): Promise<Result<ResolvedConfig, Error>> {
		let mergedUserConfig: UserConfig = structuredClone(DEFAULT_CONFIG);

		for (const provider of this.providers) {
			const result = await provider.read(ctx);
			if (result.isErr()) {
				return err(
					new Error(
						`[${provider.name}] failed: ${result.error.message}`
					)
				);
			}
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

		const validator = new ConfigValidator()
			.addRule(new LegacyKeyRule())
			.addRule(new CustomModeRule())
			.addRule(new EnforceTypeRule())
			.addRule(new UnknownKeyRule());

		return validator.validate(finalConfig);
	}
}
