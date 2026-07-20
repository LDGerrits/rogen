import { mergeDeep } from "../../base/object.js";
import { err, ok, Result } from "../../base/result.js";
import { ConfigSchema, ResolvedConfig } from "./schema.js";
import { ConfigResolver } from "./resolver.js";
import { ConfigProvider, WorkspaceContext } from "./providers/provider.js";
import { DEFAULT_CONFIG } from "./config.js";

export class ConfigService {
	private providers: ConfigProvider[] = [];

	constructor(private readonly resolver: ConfigResolver) {}

	addProvider(provider: ConfigProvider): this {
		this.providers.push(provider);
		return this;
	}

	async load(ctx: WorkspaceContext): Promise<Result<ResolvedConfig, Error>> {
		let mergedRawConfig: Record<string, unknown> =
			structuredClone(DEFAULT_CONFIG);

		// Sequential merge
		for (const provider of this.providers) {
			const result = await provider.read(ctx);

			if (result.isErr()) {
				return err(
					new Error(
						`[${provider.name}] failed: ${result.error.message}`
					)
				);
			}

			mergedRawConfig = mergeDeep(mergedRawConfig, result.unwrap());
		}

		// Resolve external dependencies
		const resolutionResult =
			await this.resolver.resolveDependencies(mergedRawConfig);

		if (resolutionResult.isErr()) {
			return err(resolutionResult.error);
		}

		// Validate and normalize
		const parseResult = ConfigSchema.safeParse(resolutionResult.unwrap());

		if (!parseResult.success) {
			const issues = parseResult.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join(", ");
			return err(new Error(`Configuration validation failed: ${issues}`));
		}

		return ok(parseResult.data);
	}
}
