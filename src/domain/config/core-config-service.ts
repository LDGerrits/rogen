import path from "path";
import { Disposable } from "../../base/disposable.js";
import { UsageError } from "../../base/errors.js";
import { toPosix } from "../../base/path.js";
import { joinedWithAnd } from "../../base/strings.js";
import { Result, err, ok } from "../../base/result.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";

import { ConfigFormatter } from "./config-formatter.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ConfigDiscovery } from "./config-discovery.js";
import { isProjectFileConfig } from "./config.js";
import { ConfigLoader } from "./config-loader.js";
import {
	ConfigEntry,
	ConfigFileCheck,
	ReloadableSelection,
	ConfigService,
	EnclosingConfigs,
	NamedProjects,
	buildableProjects,
} from "./config-service.js";
import { CoreConfigSelection } from "./core-config-selection.js";
import { ManagedConfig } from "./managed-config.js";

export class CoreConfigService implements ConfigService {
	declare readonly _serviceBrand: undefined;

	private readonly discovery: ConfigDiscovery;
	private readonly loader: ConfigLoader;
	private readonly formatter: ConfigFormatter;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {
		this.discovery = new ConfigDiscovery(
			fileSystemService,
			environmentService
		);
		this.loader = new ConfigLoader(fileSystemService);
		this.formatter = new ConfigFormatter(fileSystemService);
	}

	format(file: string): Promise<Result<boolean, Diagnostic[]>> {
		return this.formatter.format(file);
	}

	async select(
		refs: readonly string[]
	): Promise<Result<ReloadableSelection, Error>> {
		const discovered = await this.discovery.discover(refs);
		if (discovered.isErr()) return err(discovered.error);

		const {
			home: directory,
			files,
			noneNamed,
			projects,
			folders,
			homeConfig,
			scopes,
		} = discovered.value;
		const opened = await Promise.all(
			files.map((file) => ManagedConfig.open(file, this.loader))
		);
		const missing = await this.missingProject(opened, projects, scopes);
		if (missing) return err(missing);
		const home = opened.find(({ file }) => file === homeConfig);
		return ok(
			new CoreConfigSelection(
				opened,
				this.loader,
				directory,
				noneNamed && !files.some(isProjectFileConfig)
					? { directory, list: () => this.firstConfigIn(directory) }
					: undefined,
				projects,
				await this.tiesOf(homeConfig, home, folders),
				scopes
			)
		);
	}

	private relative(file: string): string {
		return (
			toPosix(path.relative(this.environmentService.cwd, file)) || file
		);
	}

	private async missingProject(
		opened: readonly ManagedConfig[],
		projects: ReadonlyMap<string, NamedProjects>,
		scopes: ReadonlyMap<string, readonly string[]>
	): Promise<UsageError | undefined> {
		for (const config of opened) {
			const names = projects.get(config.file)?.names ?? [];
			const stems = [
				...new Set(
					buildableProjects({
						...config.entry,
						scope: scopes.get(config.file),
					}).map(({ stem }) => stem)
				),
			];
			const project = names.find((name) => !stems.includes(name));
			if (project !== undefined && stems.length > 0) {
				const file = path.join(
					path.dirname(config.file),
					`${project}.project.json`
				);
				const onDisk = await this.fileSystemService.isFile(file);
				return new UsageError(
					`No project "${project}" in ${this.relative(config.file)}, which has ${joinedWithAnd(stems.map((stem) => `"${stem}"`))}.${onDisk ? ` ${project}.project.json is there, but a project file Rogen does not write is not a project.` : ""}`,
					`Projects are the keys of "projects" in rogen.json: add "${project}": {} to have Rogen write ${project}.project.json. Or name a folder with a rogen.json, or one of the projects above.`
				);
			}
		}
		return undefined;
	}

	private async tiesOf(
		homeConfig: string | undefined,
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

	private async firstConfigIn(directory: string): Promise<string[]> {
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
