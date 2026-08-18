import path from "path";
import { IConfigService, IConfigChangeEvent } from "./config.js";
import { Registry } from "../registry/registry.js";
import { Emitter, Event } from "../../base/event.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { ConfigurationModel } from "./config-models.js";
import { Extensions, IConfigurationRegistry } from "./config-registry.js";
import { FileSystemService } from "../fs/file-system-service.js";
import { EnvironmentService } from "../environment/environment-service.js";

export class ConfigService
	extends AbstractDisposable
	implements IConfigService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfiguration = this._register(
		new Emitter<IConfigChangeEvent>()
	);
	readonly onDidChangeConfiguration: Event<IConfigChangeEvent> =
		this._onDidChangeConfiguration.event;

	private consolidatedModel: ConfigurationModel;
	private fileModel: ConfigurationModel;
	private readonly cliModel: ConfigurationModel;
	private readonly registry: IConfigurationRegistry;

	constructor(
		private readonly fs: FileSystemService,
		private readonly environment: EnvironmentService
	) {
		super();
		this.registry = Registry.as<IConfigurationRegistry>(
			Extensions.Configuration
		);
		this.fileModel = new ConfigurationModel();
		this.cliModel = this.computeCliModel();
		this.consolidatedModel = new ConfigurationModel();
	}

	async initialize(): Promise<void> {
		await this.loadConfigurationFromFile();
		this.consolidate();
	}

	async reloadConfiguration(): Promise<void> {
		await this.loadConfigurationFromFile();
		this.consolidate();
		this._onDidChangeConfiguration.fire({ source: "file" });
	}

	getValue<T>(section?: string): T {
		return this.consolidatedModel.getValue<T>(section);
	}

	private consolidate(): void {
		const defaults = this.registry.getConfigurationModel();

		const merged = defaults.merge(this.fileModel).merge(this.cliModel);

		const schema = this.registry.getSchema();
		const result = schema.safeParse(merged.contents);

		if (!result.success) {
			const issues = result.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join(", ");
			throw new Error(`Configuration validation failed: ${issues}`);
		}

		this.consolidatedModel = new ConfigurationModel(result.data);
	}

	private async loadConfigurationFromFile(): Promise<void> {
		const configPath = this.environment.args.config
			? path.resolve(this.environment.cwd, this.environment.args.config)
			: path.join(this.environment.cwd, ".rogen.json");

		const isOptional = !this.environment.args.config;

		if (!(await this.fs.exists(configPath))) {
			if (!isOptional)
				throw new Error(
					`Specified config file not found: ${configPath}`
				);
			this.fileModel = new ConfigurationModel({});
			return;
		}

		try {
			const content = await this.fs.readFile(configPath);
			const parsed = JSON.parse(content);

			this.fileModel = new ConfigurationModel(parsed);
		} catch (error) {
			throw new Error(
				`Syntax Error in config JSON: ${ErrorUtils.fromUnknown(error).message}`,
				{ cause: error }
			);
		}
	}

	private computeCliModel(): ConfigurationModel {
		const args = this.environment.args;
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

		return new ConfigurationModel(overrides);
	}
}
