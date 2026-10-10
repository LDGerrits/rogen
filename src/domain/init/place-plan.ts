import { formatJsonFile } from "../../base/json.js";
import { capitalized } from "../../base/strings.js";
import { DEFAULT_CONFIG_FILE, defaultOutFileName } from "../config/config.js";
import { SyncServer } from "../serve/serve.js";
import { CompiledPlace, Darklua, Language } from "../toolchain/toolchain.js";
import { ConfigSet } from "./config-set.js";
import { BaseConfig, InitDirectory } from "./init-directory.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { PlaceFolder } from "./place-folder.js";

/** A place's name, folder and port, and what it joins: the project's language, whether Darklua processes it, and what it inherits from its config. */
export interface PlaceChoices {
	readonly name: string;
	readonly folder: PlaceFolder;
	/** The port its template serves it on, which no other place uses. */
	readonly servePort: number;
	readonly language: Language;
	readonly darklua: Darklua | undefined;
	readonly base: BaseConfig;
}

/** What one place writes and says, which a place added later and every place of a new project share. */
export class PlacePlan {
	/** A place's first port: the first above Rojo's default that `taken` lacks, so every place serves at once. */
	static freePort(taken: readonly number[]): number {
		let port = SyncServer.ROJO.defaultPort + 1;
		while (taken.includes(port)) port++;
		return port;
	}

	readonly configSet: ConfigSet;
	private readonly folder: PlaceFolder;
	private readonly servePort: number;
	private readonly rootDirs: string[];
	private readonly outDir: string | undefined;
	private readonly syncDir: string | undefined;
	private readonly compiled: CompiledPlace | undefined;

	constructor(
		private readonly directory: InitDirectory,
		{ name, folder, servePort, language, darklua, base }: PlaceChoices
	) {
		this.folder = folder;
		this.servePort = servePort;
		this.configSet = new ConfigSet(name, language, darklua);
		const { compiler } = language;
		this.rootDirs = [...base.rootDirs, folder.rootDir];
		this.outDir = compiler && `${compiler.outDir}/${name}`;
		const syncBase =
			this.configSet.syncDir && (base.syncDir ?? this.configSet.syncDir);
		this.syncDir = syncBase && `${syncBase}/${name}`;
		this.compiled =
			compiler && this.outDir
				? compiler.planPlace({
						name,
						rootDirs: this.rootDirs,
						sharedRootDirs: base.rootDirs,
						outDir: this.outDir,
						projectFile: defaultOutFileName(name),
					})
				: undefined;
	}

	/** The configs, the place's template, the compiler's own files and the one-time edits, which a project sets up for every place. */
	planFiles(builder: InitPlanBuilder): void {
		const { configSet, folder, syncDir, compiled } = this;
		builder.addDirectory(folder.rootDir);
		configSet.planConfigs(
			builder,
			{
				extends: ConfigSet.reference(DEFAULT_CONFIG_FILE),
				rootDirs: [folder.rootDir],
				template: folder.template,
			},
			syncDir
		);
		if (folder.hasTemplate) builder.addNote(`Using ${folder.template}.`);
		else
			builder.addPlaceTemplate({
				fileName: folder.template,
				content: formatJsonFile({
					name: capitalized(configSet.name),
					servePort: this.servePort,
					tree: { $className: "DataModel" },
				}),
			});
		for (const file of compiled?.files ?? []) builder.addCompilerFile(file);
		builder.addSetup(...(compiled?.setup ?? []));
	}

	/** The commands that compile, process and serve the place; `serveCommand` serves it with the others, and only one place keeps the sourcemap current, since there is one. */
	planSteps(
		builder: InitPlanBuilder,
		serveCommand: string,
		sourcemap = true
	): void {
		const { configSet, rootDirs, syncDir, compiled, outDir } = this;
		configSet.planSteps(builder, this.directory.path, {
			compileCommand: compiled?.compileCommand,
			serveCommand,
			processed: outDir ? [outDir] : rootDirs,
			syncDir,
			sourcemap,
		});
	}

	/** The command that serves `places` at once, each on its own port: every config when nothing else here shares a port, else the places by name, as with Darklua, whose shared synced config would be served too. */
	static serveCommandOf(
		places: readonly PlacePlan[],
		sharedPort = false
	): string {
		const [first] = places;
		if (!first?.configSet.sourced && !sharedPort) return "rogen serve";
		return `rogen serve ${places
			.map(({ configSet }) =>
				configSet.sourced ? configSet.syncStem : configSet.name
			)
			.join(" ")}`;
	}
}
