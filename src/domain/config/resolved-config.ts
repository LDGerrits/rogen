import path from "path";
import { commonAncestor, samePath, toPosix } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Target } from "../roblox/roblox.js";
import {
	ParsedProjectFile,
	RojoProject,
	projectFileName,
	stemOfProjectFile,
} from "../rojo/rojo-project.js";
import { SyncRules } from "../rojo/sync-rules.js";
import { DEFAULT_PROJECT, DEFAULT_SOURCE_PATH } from "./config.js";
import { DeclaredKeys } from "./declared-keys.js";

interface ResolvedConfigFields {
	readonly file: string;
	/** The project this describes: `default`, or the name of an entry of `projects`. */
	readonly stem: string;
	/** Every project the config file writes, `default` first. */
	readonly projectStems: readonly string[];
	readonly serveProject: string;
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
	readonly stem: string;
	readonly projectStems: readonly string[];
	readonly serveProject: string;
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
		this.stem = fields.stem;
		this.projectStems = fields.projectStems;
		this.serveProject = fields.serveProject;
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

	/** What the project is asked for by: the name of the game, and for a project of the config its own name beside it. */
	get label(): string {
		return this.stem === DEFAULT_PROJECT
			? this.projectName
			: `${this.projectName} (${this.stem})`;
	}

	/** Tells this project from every other that is served or built: its config file and its name there. */
	get id(): string {
		return `${this.file}#${this.stem}`;
	}

	/** The port a place is served on unless a flag says otherwise: its `servePort`, else the one its position in the list gives. */
	get placeServePort(): number | undefined {
		return this.isPlace
			? (this.project.servePort ?? this.placePort)
			: undefined;
	}

	get isDefault(): boolean {
		return this.stem === DEFAULT_PROJECT;
	}

	get projectDir(): string {
		return path.dirname(this.file);
	}

	get projectFile(): string {
		return this.fileOf(this.stem);
	}

	/** Whether the config is a Rojo project file Rogen was not given a config for: it is its own output and is never written. */
	get isAdopted(): boolean {
		return samePath(this.file, this.projectFile);
	}

	get projectFiles(): readonly string[] {
		return this.projectStems.map((stem) => this.fileOf(stem));
	}

	/** The file of a project; the description of a config that is a Rojo project file is that file, whatever its name. */
	private fileOf(stem: string): string {
		return stem === DEFAULT_PROJECT &&
			stemOfProjectFile(path.basename(this.file)) !== undefined
			? this.file
			: path.join(this.projectDir, projectFileName(stem));
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

/** A `rogen.json` resolved: the description and the projects it writes beside it. */
export interface ResolvedConfigFile {
	readonly config: ResolvedConfig;
	readonly projects: readonly ResolvedConfig[];
	/** The places it lists, sorted by path. */
	readonly places?: readonly ResolvedConfigFile[];
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

/** Every project a resolved config file writes, the description first, then each place's; a `scope` limits the places to those folders. */
export function projectsOf(
	resolved: ResolvedConfigFile,
	scope?: readonly string[]
): ResolvedConfig[] {
	return [
		...(scope === undefined ? [resolved.config, ...resolved.projects] : []),
		...placesIn(resolved, scope).flatMap((place) => projectsOf(place)),
	];
}
