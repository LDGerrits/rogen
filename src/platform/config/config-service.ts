import { mergeDeep } from "../../base/object.js";
import { err, Result } from "../../base/result.js";
import { DEFAULT_CONFIG, ResolvedConfig, UserConfig } from "./config.js";
import { ConfigNormalizer } from "./normalizer.js";
import { IConfigProvider, WorkspaceContext } from "./providers/provider.js";
import { ConfigValidator } from "./validator.js";

export class ConfigService {
	private providers: IConfigProvider[] = [];

	constructor(
		private readonly normalizer: ConfigNormalizer,
		private readonly validator: ConfigValidator
	) {}

	addProvider(provider: IConfigProvider): this {
		this.providers.push(provider);
		return this;
	}

	async load(ctx: WorkspaceContext): Promise<Result<ResolvedConfig, Error>> {
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

		const normalizationResult =
			await this.normalizer.normalize(mergedUserConfig);

		if (normalizationResult.isErr()) {
			return err(normalizationResult.error);
		}

		return this.validator.validate(normalizationResult.unwrap());
	}
}
