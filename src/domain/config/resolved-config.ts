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
	readonly syncPath?: string;
	/** The absolute POSIX folder the patterns of `syncRules` are relative to, when it is not the config's own: a place takes the rules of the config that lists it. */
	readonly syncRulesDir?: string;
	readonly warnings: readonly Diagnostic[];
	/** The config file that lists this folder as a place; for anything else, `file` itself. */
	readonly rootFile?: string;
	readonly isPlace?: boolean;
	/** Whether the config lists places; such a config is never served. */
	readonly hasPlaces?: boolean;
	/** The port this place is served on when no `servePort` says otherwise. */
	readonly placePort?: number;
}

/** A config with its values validated: paths are absolute and route targets are parsed. */
export class ResolvedConfig {
	readonly file: string;
	readonly projectName: string;
	readonly project: RojoProject<ParsedProjectFile>;
	readonly sourcePaths: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly ignored: readonly string[];
	readonly syncPath?: string;
	readonly warnings: readonly Diagnostic[];
	readonly rootFile: string;
	readonly isPlace: boolean;
	readonly hasPlaces: boolean;
	readonly placePort?: number;
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
		this.syncPath = fields.syncPath;
		this.warnings = fields.warnings;
		this.rootFile = fields.rootFile ?? fields.file;
		this.isPlace = fields.isPlace ?? false;
		this.hasPlaces = fields.hasPlaces ?? false;
		this.placePort = fields.placePort;
		this.keys = new DeclaredKeys(fields.routes.keys());
		this.syncRules = SyncRules.following(
			SyncRules.read(fields.project.syncRules).rules,
			toPosix(this.projectDir),
			fields.syncRulesDir
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

	/** The port a place is served on unless a flag says otherwise: its `servePort`, else the one its position in the list gives. */
	get placeServePort(): number | undefined {
		return this.isPlace
			? (this.project.servePort ?? this.placePort)
			: undefined;
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

/** A `.rogen.json` resolved, with the places it lists. */
export interface ResolvedConfigFile {
	readonly config: ResolvedConfig;
	/** The places it lists, sorted by path. */
	readonly places?: readonly ResolvedConfigFile[];
	/** The folders its `placePaths` match that hold its source paths: the code the places share, which are not places. */
	readonly sharedFolders?: readonly string[];
}

export function placesIn(
	resolved: ResolvedConfigFile,
	scope?: readonly string[]
): ResolvedConfigFile[] {
	return (resolved.places ?? []).filter(
		({ config }) =>
			scope === undefined ||
			scope.some((folder) => samePath(config.projectDir, folder))
	);
}

/** Every config a resolved file holds, its own first, then each place's; a `scope` limits the places to those folders. */
export function configsOf(
	resolved: ResolvedConfigFile,
	scope?: readonly string[]
): ResolvedConfig[] {
	return [
		...(scope === undefined ? [resolved.config] : []),
		...placesIn(resolved, scope).flatMap((place) => configsOf(place)),
	];
}
