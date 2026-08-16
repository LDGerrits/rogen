import { err, ok, Result } from "../../base/result.js";
import { ConfigService } from "../../platform/config/config-service.js";
import { WorkspaceService } from "../workspace/workspace-service.js";
import { ConfigResolver } from "./config-resolver.js";
import { ConfigSchema, defaultConfig, ResolvedConfig } from "./schema.js";

export class ConfigLoader {
	constructor(
		private readonly configService: ConfigService,
		private readonly configResolver: ConfigResolver,
		private readonly workspaceService: WorkspaceService,
		private readonly configDir: string
	) {}

	async load(): Promise<Result<ResolvedConfig, Error>> {
		// Merge
		const mergeResult = await this.configService.resolve(
			defaultConfig as Record<string, unknown>
		);

		if (mergeResult.isErr()) {
			return err(mergeResult.error);
		}

		const rawConfig = mergeResult.unwrap();

		const toolchain = await this.workspaceService.detectToolchain();
		rawConfig.toolchain = toolchain;

		// Resolve
		const resolutionResult = await this.configResolver.resolveDependencies(
			rawConfig,
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
