import path from "path";
import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { toPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Result, err, ok } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

import { ConfigDiscovery } from "./config-discovery.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigFileCheck,
	ReloadableSelection,
	ConfigService,
	EnclosingConfigs,
	buildableProjects,
} from "./config-service.js";
import { CoreConfigSelection } from "./core-config-selection.js";
import { ManagedConfig } from "./managed-config.js";

export class CoreConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;

	constructor(
		fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService);
	}

	async select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>> {
		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		const {
			home: directory,
			files,
			everyConfig,
			projects,
			folders,
			homeConfig,
			scopes,
		} = discovered.value;
		const opened = await Promise.all(
			files.map((file) => ManagedConfig.open(file, this.loader))
		);
		const missing = this.missingProject(opened, projects, scopes);
		if (missing) return err(missing);
		const home = opened.find(({ file }) => file === homeConfig);
		return ok(
			new CoreConfigSelection(
				opened,
				this.loader,
				directory,
				everyConfig
					? { directory, list: () => this.configsIn(directory) }
					: undefined,
				projects,
				await this.tiesOf(homeConfig, home, folders),
				scopes
			)
		);
	}

	/** The config as the user names it. */
	private relative(file: string): string {
		return (
			toPosix(path.relative(this.environmentService.cwd, file)) || file
		);
	}

	/** An error when a config that loads doesn't have a project named for it. */
	private missingProject(
		opened: readonly ManagedConfig[],
		projects: ReadonlyMap<string, string>,
		scopes: ReadonlyMap<string, readonly string[]>
	): UsageError | undefined {
		for (const config of opened) {
			const project = projects.get(config.file);
			const stems = [
				...new Set(
					buildableProjects({
						...config.entry,
						scope: scopes.get(config.file),
					}).map(({ stem }) => stem)
				),
			];
			if (project === undefined || stems.length === 0) continue;
			if (!stems.includes(project))
				return new UsageError(
					`No project "${project}" in ${this.relative(config.file)}, which has ${joinedWithAnd(stems.map((stem) => `"${stem}"`))}. Name a folder with a rogen.json, a *.project.json path, or one of them.`
				);
		}
		return undefined;
	}

	/** What to tell of each name that is both a folder with a config and a project of the config here: the folder is what it names. */
	private async tiesOf(
		homeConfig: string | undefined,
		/** The config of `homeConfig` when the selection holds it. */
		opened: ManagedConfig | undefined,
		folders: readonly string[]
	): Promise<string[]> {
		if (folders.length === 0 || !homeConfig) return [];
		const projects = buildableProjects(
			(opened ?? (await ManagedConfig.open(homeConfig, this.loader)))
				.entry
		);
		return folders.flatMap((name) =>
			projects.some(({ stem }) => stem === name)
				? [
						`"${name}" is a folder with a rogen.json and also a project of ${this.relative(homeConfig)}: using the folder. To use the project, name its file, ${name}.project.json.`,
					]
				: []
		);
	}

	/** The config of `directory` a followed folder holds: the first when both names appear, since it takes a restart to refuse that. */
	private async configsIn(directory: string): Promise<string[]> {
		return (await this.discovery.list(directory)).slice(0, 1);
	}

	findEnclosing(from?: string): Promise<EnclosingConfigs | undefined> {
		return this.discovery.findEnclosing(from);
	}

	async read(file: string): Promise<ConfigEntry> {
		return (await ManagedConfig.open(file, this.loader)).entry;
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		return this.loader.registerFileCheck(check);
	}
}
