import path from "path";
import { commonAncestor, samePath } from "../../base/path.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { Target } from "../roblox/roblox.js";
import {
	ParsedProjectFile,
	RojoProject,
	projectFileName,
} from "../rojo/rojo-project.js";
import { DEFAULT_PROJECT, DEFAULT_SOURCE_PATH } from "./config.js";
import { DeclaredKeys } from "./declared-keys.js";

interface ResolvedConfigFields {
	/** The config file itself. */
	readonly file: string;
	/** The project this describes: `default`, or the name of an entry of `projects`. */
	readonly stem: string;
	/** Every project the config file writes, `default` first. */
	readonly projectStems: readonly string[];
	/** The project `rogen serve` serves when none is named. */
	readonly serveProject: string;
	/** The name Rojo and Rogen know the project by: the file's `name`, else its folder's. */
	readonly projectName: string;
	/** The Rojo project file the config describes, its tree as the user wrote it and the keys Rogen doesn't read passed through. Every `$path` and glob is relative to the config's folder. */
	readonly project: RojoProject<ParsedProjectFile>;
	/** Absolute. */
	readonly sourcePaths: readonly string[];
	/** In declaration order. */
	readonly routes: ReadonlyMap<string, Target>;
	/** `globIgnorePaths` as globs on absolute POSIX paths, which keep scanned files out of routing. */
	readonly ignored: readonly string[];
	/** Absolute. */
	readonly syncPath?: string;
	/** What the config says that is no error: a key Rojo will reject in the written file. */
	readonly warnings: readonly Diagnostic[];
	/** The config file that lists this folder as a place; for anything else, `file` itself. */
	readonly rootFile?: string;
	/** Whether this is a place of another config. */
	readonly isPlace?: boolean;
	/** Whether the config lists places, which makes it a shared root that is never served. */
	readonly hasPlaces?: boolean;
	/** The port this place is served on when no `servePort` says otherwise. */
	readonly placePort?: number;
}

/** A config with its values validated: every path is absolute and every route target is parsed. */
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
	}

	/** What the project is asked for by: the name of the game, and for a project of the config its own name beside it. */
	get label(): string {
		return this.stem === DEFAULT_PROJECT
			? this.projectName
			: `${this.projectName} (${this.stem})`;
	}

	/** What tells this project from every other that is served or built: the config it is read from, and its name there. */
	get id(): string {
		return `${this.file}#${this.stem}`;
	}

	/** The port a place is served on unless a flag says otherwise: its `servePort`, else the one its place in the list gives. `undefined` for anything that is not a place. */
	get placeServePort(): number | undefined {
		return this.isPlace
			? (this.project.servePort ?? this.placePort)
			: undefined;
	}

	/** Whether this is the description itself, not an entry of `projects`. */
	get isDefault(): boolean {
		return this.stem === DEFAULT_PROJECT;
	}

	/** The directory the project file is written to, and every path in it is relative to. */
	get projectDir(): string {
		return path.dirname(this.file);
	}

	/** The project file the project is written to. */
	get projectFile(): string {
		return path.join(this.projectDir, projectFileName(this.stem));
	}

	/** Every project file the config file writes, which a source path that holds them must not scan. */
	get projectFiles(): readonly string[] {
		return this.projectStems.map((stem) =>
			path.join(this.projectDir, projectFileName(stem))
		);
	}

	/** The folders a build lists: its source paths, else the folder it would have scanned by default, to find files nothing mounts. */
	get indexedPaths(): readonly string[] {
		return this.routes.size > 0
			? this.sourcePaths
			: [path.join(this.projectDir, DEFAULT_SOURCE_PATH)];
	}

	/** The deepest directory holding every source path, or `undefined` without any. */
	get commonRoot(): string | undefined {
		return this.sourcePaths.length > 0
			? commonAncestor(this.sourcePaths)
			: undefined;
	}
}

/** A `rogen.json` resolved: the description, and the projects it writes beside it. */
export interface ResolvedConfigFile {
	/** The description itself, written as `default.project.json`. */
	readonly config: ResolvedConfig;
	/** The entries of `projects`, in the order they are declared. */
	readonly projects: readonly ResolvedConfig[];
	/** The places it lists, sorted by path. */
	readonly places?: readonly ResolvedConfigFile[];
}

/** The places of a resolved config file, or with a `scope` only those in those folders. */
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

/** Every project a resolved config file writes, the description first and then each place's; with a `scope`, only the places in those folders. */
export function projectsOf(
	resolved: ResolvedConfigFile,
	scope?: readonly string[]
): ResolvedConfig[] {
	return [
		...(scope === undefined ? [resolved.config, ...resolved.projects] : []),
		...placesIn(resolved, scope).flatMap((place) => projectsOf(place)),
	];
}
