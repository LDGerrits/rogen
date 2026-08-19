import { ConfigChangeEvent, ConfigService, ConfigTarget } from "./config.js";
import { Emitter, Event } from "../../base/event.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Config, ConfigValue, ConfigModel } from "./config-models.js";
import { FileSystemService, FileType } from "../fs/file-system-service.js";
import { EnvironmentService } from "../environment/environment-service.js";
import { DefaultConfig, CliConfig, ProjectConfig } from "./configs.js";
import path from "path";

export class CoreConfigService
	extends AbstractDisposable
	implements ConfigService
{
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConfig = this._register(
		new Emitter<ConfigChangeEvent>()
	);
	readonly onDidChangeConfig: Event<ConfigChangeEvent> =
		this._onDidChangeConfig.event;

	private config!: Config;

	private readonly defaultConfig: DefaultConfig;
	private readonly cliConfig: CliConfig;
	private projectConfig!: ProjectConfig;

	private memoryModel: ConfigModel = new ConfigModel({});
	private _resolvedConfigPath: string | undefined;

	get configPath(): string | undefined {
		return this._resolvedConfigPath;
	}

	constructor(
		private readonly fs: FileSystemService,
		private readonly environment: EnvironmentService
	) {
		super();
		this.defaultConfig = this._register(new DefaultConfig());
		this.cliConfig = this._register(new CliConfig(this.environment));
	}

	async initialize(): Promise<void> {
		this._resolvedConfigPath = await this.discoverProjectConfigPath();

		this.projectConfig = this._register(
			new ProjectConfig(this._resolvedConfigPath, this.fs)
		);
		this._register(
			this.projectConfig.onDidChangeConfig(() =>
				this.onDidProjectConfigChange()
			)
		);

		await Promise.all([
			this.defaultConfig.initialize(),
			this.projectConfig.initialize(),
			this.cliConfig.initialize(),
		]);

		this.rebuildConfig();
	}

	async reloadConfig(): Promise<void> {
		await this.projectConfig.reload();
	}

	getValue<T>(section?: string): T {
		return this.config.getValue<T>(section);
	}

	inspect<T>(section: string): ConfigValue<T> {
		return this.config.inspect<T>(section);
	}

	private onDidProjectConfigChange(): void {
		const previousConfig = this.config;

		this.rebuildConfig();

		const changedKeys = previousConfig.compare(this.config);

		if (changedKeys.length > 0) {
			const event = new ConfigChangeEvent(
				changedKeys,
				ConfigTarget.PROJECT
			);
			this._onDidChangeConfig.fire(event);
		}
	}

	private rebuildConfig(): void {
		this.config = new Config(
			this.defaultConfig.configurationModel,
			this.projectConfig.configurationModel,
			this.cliConfig.configurationModel,
			this.memoryModel
		);

		const validatedData = this.validateConfig();
		this.config.setValidatedModel(new ConfigModel(validatedData));
	}

	private validateConfig(): Record<string, unknown> {
		const schema = this.defaultConfig.getSchema();
		const contents = this.config.getConsolidatedModel().contents;
		const result = schema.safeParse(contents);

		if (!result.success) {
			const issues = result.error.issues
				.map((i) => `${i.path.join(".")}: ${i.message}`)
				.join(", ");
			throw new Error(`Config validation failed: ${issues}`);
		}

		return result.data;
	}

	private async discoverProjectConfigPath(): Promise<string | undefined> {
		if (this.environment.args.config) {
			const targetPath = path.resolve(
				this.environment.cwd,
				this.environment.args.config
			);
			if (!(await this.fs.exists(targetPath))) {
				throw new Error(
					`Specified config file not found: ${targetPath}`
				);
			}
			return targetPath;
		}

		const cwd = this.environment.cwd;
		if (!(await this.fs.exists(cwd))) {
			return undefined;
		}

		const entries = await this.fs.readDirectory(cwd);
		const rogenFiles = entries
			.filter(
				([name, type]) =>
					type === FileType.File && name.endsWith(".rogen.json")
			)
			.map(([name]) => name);

		if (rogenFiles.length === 0) return undefined;

		if (rogenFiles.includes(".rogen.json")) {
			return path.join(cwd, ".rogen.json");
		}

		if (rogenFiles.length === 1) {
			return path.join(cwd, rogenFiles[0]);
		}

		return undefined;
	}
}
