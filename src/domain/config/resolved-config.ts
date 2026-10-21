import path from "path";
import { commonAncestor, samePath, toPosix } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Target } from "../roblox/roblox.js";
import {
	ParsedProjectFile,
	RojoProject,
	projectFileName,
} from "../rojo/rojo-project.js";
import { SyncRules } from "../rojo/sync-rules.js";
import {
	DEFAULT_PROJECT,
	DEFAULT_SOURCE_PATH,
	configStem,
	isProjectFileConfig,
} from "./config.js";
import { DeclaredKeys } from "./declared-keys.js";

interface ResolvedConfigFields {
	readonly file: string;
	/** The name Rojo and Rogen know the project by: the file's `name`, else its folder's. */
	readonly projectName: string;
	/** The Rojo project file the config describes; every `$path` and glob is relative to the config's folder. */
	readonly project: RojoProject<ParsedProjectFile>;
	/** Absolute. */
	readonly sourcePaths: readonly string[];
	/** In declaration order. */
	readonly routes: ReadonlyMap<string, Target>;
	/** `globIgnorePaths` as globs on absolute POSIX paths. */
	readonly ignored: readonly string[];
	/** Absolute. */
	readonly compiledPath?: string;
	readonly warnings: readonly Diagnostic[];
}

/** A config with its values validated: paths are absolute and route targets are parsed. */
export class ResolvedConfig {
	readonly file: string;
	readonly projectName: string;
	readonly project: RojoProject<ParsedProjectFile>;
	readonly sourcePaths: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly ignored: readonly string[];
	readonly compiledPath?: string;
	readonly warnings: readonly Diagnostic[];
	readonly keys: DeclaredKeys;
	/** The project's `syncRules` in front of Rojo's. */
	readonly syncRules: SyncRules;

	constructor(fields: ResolvedConfigFields) {
		this.file = fields.file;
		this.projectName = fields.projectName;
		this.project = fields.project;
		this.sourcePaths = fields.sourcePaths;
		this.routes = fields.routes;
		this.ignored = fields.ignored;
		this.compiledPath = fields.compiledPath;
		this.warnings = fields.warnings;
		this.keys = new DeclaredKeys(fields.routes.keys());
		this.syncRules = SyncRules.following(
			SyncRules.read(fields.project.syncRules).rules,
			toPosix(this.projectDir)
		);
	}

	/** What the project is asked for by: the name of the game. */
	get label(): string {
		return this.projectName;
	}

	/** Tells this project from every other that is served or built: its config file. */
	get id(): string {
		return this.file;
	}

	get projectDir(): string {
		return path.dirname(this.file);
	}

	/** The Rojo project file the config writes, beside it and named for its stem; for a config that is a Rojo project file, that file. */
	get projectFile(): string {
		return isProjectFileConfig(this.file)
			? this.file
			: path.join(
					this.projectDir,
					projectFileName(configStem(this.file) ?? DEFAULT_PROJECT)
				);
	}

	/** Whether the config is a Rojo project file Rogen was not given a config for: it is its own output and is never written. */
	get isAdopted(): boolean {
		return samePath(this.file, this.projectFile);
	}

	/** The folders a build lists to find files nothing mounts: its source paths, else the default folder. */
	get indexedPaths(): readonly string[] {
		return this.routes.size > 0
			? this.sourcePaths
			: [path.join(this.projectDir, DEFAULT_SOURCE_PATH)];
	}

	get commonRoot(): string | undefined {
		return this.sourcePaths.length > 0
			? commonAncestor(this.sourcePaths)
			: undefined;
	}
}

/** Where `compiledPath` repeats `file`: under the common folder of the source paths, as tsc's `outDir` does under `rootDir`; `file` itself without a compiled path. */
export function compiledPathOf(
	config: Pick<ResolvedConfig, "commonRoot" | "compiledPath" | "projectDir">,
	file: string
): string {
	if (config.compiledPath === undefined) return file;
	return path.join(
		config.compiledPath,
		path.relative(config.commonRoot ?? config.projectDir, file)
	);
}

/** A `.rogen.json` resolved. */
export interface ResolvedConfigFile {
	readonly config: ResolvedConfig;
}
