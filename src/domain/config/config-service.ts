import path from "path";
import { ResolvedConfig, parseConfig } from "../../domain/config/config.js";
import { Result, err, ok } from "../../base/result.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ConfigReader } from "../../platform/config/config-reader.js";

export interface ConfigService {
	readonly _serviceBrand: undefined;

	getValue(): ResolvedConfig;
	reload(): Promise<Result<void, Error>>;
}

export class RogenConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private constructor(
		private config: ResolvedConfig,
		private readonly fs: FileSystemService,
		private readonly environment: EnvironmentService
	) {}

	getValue(): ResolvedConfig {
		return this.config;
	}

	async reload(): Promise<Result<void, Error>> {
		const configPath = this.environment.args.config
			? path.resolve(this.environment.cwd, this.environment.args.config)
			: path.join(this.environment.cwd, ".rogen.json");

		const overrides = RogenConfigService.computeOverrides(this.environment);
		const reader = new ConfigReader(this.fs);

		const rawResult = await reader.read({
			configPath,
			isOptional: false,
			overrides,
		});
		if (rawResult.isErr()) return err(rawResult.error);

		const parsedResult = await parseConfig(
			rawResult.unwrap(),
			path.dirname(configPath),
			this.fs
		);
		if (parsedResult.isErr()) return err(parsedResult.error);

		this.config = parsedResult.unwrap();
		return ok(undefined);
	}

	/**
	 * Resolves the config before instantiating the service.
	 */
	static async create(
		fs: FileSystemService,
		environment: EnvironmentService
	): Promise<Result<ConfigService, Error>> {
		const configPath = environment.args.config
			? path.resolve(environment.cwd, environment.args.config)
			: path.join(environment.cwd, ".rogen.json");

		const configDir = path.dirname(configPath);
		const overrides = RogenConfigService.computeOverrides(environment);
		const isOptional = !environment.args.config;

		const reader = new ConfigReader(fs);
		const rawResult = await reader.read({
			configPath,
			isOptional,
			overrides,
		});

		if (rawResult.isErr()) return err(rawResult.error);

		const parsedResult = await parseConfig(
			rawResult.unwrap(),
			configDir,
			fs
		);

		if (parsedResult.isErr()) return err(parsedResult.error);

		return ok(
			new RogenConfigService(parsedResult.unwrap(), fs, environment)
		);
	}

	private static computeOverrides(
		environment: EnvironmentService
	): Record<string, unknown> {
		const args = environment.args;
		const overrides: Record<string, unknown> = {};

		if (args.source) overrides.source = args.source;

		if (args.build || args.output || args.env) {
			const targetModes = args.mode || ["luau", "ts", "darklua"];
			for (const mode of targetModes) {
				overrides[mode] = {
					...(args.build && { build: args.build }),
					...(args.output && { output: args.output }),
					...(args.env && { env: args.env }),
				};
			}
		}

		return overrides;
	}
}
