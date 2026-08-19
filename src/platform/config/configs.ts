import { ConfigModel } from "./config-models.js";
import { Extensions, ConfigRegistry } from "./config-registry.js";
import { Registry } from "../registry/registry.js";
import { FileSystemService } from "../fs/file-system-service.js";
import { EnvironmentService } from "../environment/environment-service.js";
import { ErrorUtils } from "../../base/errors.js";
import { AbstractDisposable } from "../../base/disposable.js";
import { Emitter, Event } from "../../base/event.js";

export interface ConfigLoader {
	readonly onDidChangeConfig: Event<void>;
	readonly configurationModel: ConfigModel;
	initialize(): Promise<ConfigModel>;
}

export class DefaultConfig extends AbstractDisposable implements ConfigLoader {
	private readonly _onDidChangeConfig = this._register(new Emitter<void>());
	readonly onDidChangeConfig: Event<void> = this._onDidChangeConfig.event;

	private _configurationModel: ConfigModel = new ConfigModel();
	get configurationModel(): ConfigModel {
		return this._configurationModel;
	}

	private readonly registry: ConfigRegistry;

	constructor() {
		super();
		this.registry = Registry.as<ConfigRegistry>(Extensions.Config);
	}

	async initialize(): Promise<ConfigModel> {
		this._configurationModel = this.registry.getConfigModel();
		return this.configurationModel;
	}

	getSchema() {
		return this.registry.getSchema();
	}
}

export class CliConfig extends AbstractDisposable implements ConfigLoader {
	readonly onDidChangeConfig: Event<void> = () => ({
		[Symbol.dispose]: () => {},
	});

	private _configurationModel: ConfigModel = new ConfigModel();
	get configurationModel(): ConfigModel {
		return this._configurationModel;
	}

	constructor(private readonly environment: EnvironmentService) {
		super();
	}

	async initialize(): Promise<ConfigModel> {
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

		this._configurationModel = new ConfigModel(overrides);
		return this.configurationModel;
	}
}

export class ProjectConfig extends AbstractDisposable implements ConfigLoader {
	private readonly _onDidChangeConfig = this._register(new Emitter<void>());
	readonly onDidChangeConfig: Event<void> = this._onDidChangeConfig.event;

	private _configurationModel: ConfigModel = new ConfigModel();
	get configurationModel(): ConfigModel {
		return this._configurationModel;
	}

	constructor(
		public readonly targetPath: string | undefined,
		private readonly fs: FileSystemService
	) {
		super();
	}

	async initialize(): Promise<ConfigModel> {
		this._configurationModel = await this.doLoadConfig();
		return this.configurationModel;
	}

	async reload(): Promise<ConfigModel> {
		this._configurationModel = await this.doLoadConfig();
		this._onDidChangeConfig.fire();
		return this.configurationModel;
	}

	private async doLoadConfig(): Promise<ConfigModel> {
		if (!this.targetPath || !(await this.fs.exists(this.targetPath))) {
			return new ConfigModel({});
		}

		try {
			const content = await this.fs.readFile(this.targetPath);
			const parsed = JSON.parse(content);
			return new ConfigModel(parsed);
		} catch (error) {
			throw new Error(
				`Syntax Error in config JSON: ${ErrorUtils.fromUnknown(error).message}`,
				{ cause: error }
			);
		}
	}
}
