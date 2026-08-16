import { err, ok, Result } from "../../base/result.js";
import { ConfigService } from "../../platform/config/config-service.js";
import { ConfigResolver } from "./resolver.js";
import { ConfigSchema, DEFAULT_CONFIG, ResolvedConfig } from "./schema.js";

export class ConfigLoader {
	constructor(
		private readonly configService: ConfigService,
		private readonly resolver: ConfigResolver,
		private readonly configDir: string
	) {}

	async load(): Promise<Result<ResolvedConfig, Error>> {
		// Merge
		const mergeResult = await this.configService.resolve(
			DEFAULT_CONFIG as Record<string, unknown>
		);

		if (mergeResult.isErr()) {
			return err(mergeResult.error);
		}

		// Resolve
		const resolutionResult = await this.resolver.resolveDependencies(
			mergeResult.unwrap(),
			this.configDir
		);

		if (resolutionResult.isErr()) {
			return err(resolutionResult.error);
		}

		// Validate
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
