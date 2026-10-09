import { formatJsonFile } from "../../base/json.js";
import { capitalized } from "../../base/strings.js";
import { defaultOutFileName } from "../config/config.js";
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

/** The command that serves every place at once, since each has its own port. */
const SERVE_EVERY_PLACE = "rogen serve";

/** What one place writes and says, which a place added later and every place of a new project share. */
export class PlacePlan {
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
				extends: ConfigSet.reference(ConfigSet.DEFAULT_FILE),
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

	/** The commands that build and serve the places; a project gives them for its first place only. */
	planSteps(builder: InitPlanBuilder): void {
		const { configSet, rootDirs, syncDir, compiled, outDir } = this;
		configSet.planSteps(builder, this.directory, {
			compileCommand: compiled?.compileCommand,
			serveCommand: SERVE_EVERY_PLACE,
			processed: outDir ? [outDir] : rootDirs,
			syncDir,
		});
	}
}
