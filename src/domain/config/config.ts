import path from "path";
import { formatJsonFile, safeStringify } from "../../base/json.js";
import { commonAncestor, isInside } from "../../base/path.js";
import { Target } from "../roblox/roblox.js";
import {
	PROJECT_SUFFIX,
	ParsedProjectFile,
	RojoProject,
	projectFileName,
} from "../rojo/rojo-project.js";

export interface RogenConfig {
	readonly $schema?: string;
	readonly extends?: string;
	readonly rootDirs?: string[];
	readonly routes?: Record<string, string>;
	readonly tags?: Record<string, boolean>;
	readonly exclude?: string[];
	readonly template?: string;
	readonly syncDir?: string;
	readonly outFile?: string;
}

export const CONFIG_SUFFIX = ".rogen.json";
export const DEFAULT_CONFIG_STEM = "default";

export const configFileName = (stem: string): string =>
	`${stem}${CONFIG_SUFFIX}`;

/** The name a config is asked for by, e.g. `lobby` for `lobby.rogen.json`. */
export const configLabel = (file: string): string =>
	path.basename(file, CONFIG_SUFFIX);

/** The project file a config named `label` writes unless its `outFile` says otherwise. */
export const defaultOutFileName = (label: string): string =>
	projectFileName(label);

/** The label of the config that writes `fileName` by default, when it is named the way a default output is. */
export function labelOfDefaultOutFile(fileName: string): string | undefined {
	return fileName.endsWith(PROJECT_SUFFIX)
		? fileName.slice(0, -PROJECT_SUFFIX.length)
		: undefined;
}

const SCHEMA_BASE_URL = "https://ldgerrits.github.io/rogen/schema";

/** The schema a config written by this release points at. */
export const SCHEMA_URL = schemaUrlFor("2.0.0");

export function schemaUrlFor(version: string): string {
	const channel = version.includes("-") ? version : version.split(".")[0];
	return `${SCHEMA_BASE_URL}/${channel}/rogen.json`;
}

/** A config file's text as Rogen writes one: strict JSON that points at this release's schema. */
export function configFileContent(config: RogenConfig): string {
	return formatJsonFile({ $schema: SCHEMA_URL, ...config });
}

/** How a root dir overlaps another of `rootDirs`; a file under both would belong to both. */
export type RootDirOverlap =
	| { readonly kind: "duplicate" }
	| { readonly kind: "nested"; readonly outer: string };

/** How the root dir at `index` overlaps an earlier or enclosing one, if it does. All paths absolute. */
export function rootDirOverlap(
	rootDirs: readonly string[],
	index: number
): RootDirOverlap | undefined {
	const rootDir = rootDirs[index];
	// Compared as paths, since a case-insensitive file system makes `src` and `Src` one folder.
	const first = rootDirs.findIndex(
		(other) => path.relative(other, rootDir) === ""
	);
	if (first !== index) return { kind: "duplicate" };
	const outer = rootDirs.find((other) => isInside(rootDir, other));
	return outer === undefined ? undefined : { kind: "nested", outer };
}

/** The route and tag keys a config declares; a name spells a key exactly or with its first letter flipped. */
export class DeclaredKeys {
	/** The route that takes every file no other route claims. */
	static readonly FALLBACK_ROUTE = "*";

	private static readonly NAME = /^[A-Za-z][A-Za-z0-9]*$/;

	/** Every route key but the fallback, which no name can spell. */
	readonly routeKeys: ReadonlySet<string>;
	readonly tagKeys: ReadonlySet<string>;
	readonly all: ReadonlySet<string>;

	constructor(routeKeys: Iterable<string>, tagKeys: Iterable<string>) {
		this.routeKeys = new Set(
			[...routeKeys].filter((key) => key !== DeclaredKeys.FALLBACK_ROUTE)
		);
		this.tagKeys = new Set(tagKeys);
		this.all = new Set([...this.routeKeys, ...this.tagKeys]);
	}

	/** Whether `text` can be a key: letters and digits, starting with a letter. */
	static isName(text: string): boolean {
		return DeclaredKeys.NAME.test(text);
	}

	/** Keys that share this identity match the same names. */
	static identityOf(key: string): string {
		return key.slice(0, 1).toLowerCase() + key.slice(1);
	}

	/** The same name with the first letter in the other case. */
	static flipFirstLetter(name: string): string {
		const first = name[0];
		const flipped =
			first === first.toLowerCase()
				? first.toUpperCase()
				: first.toLowerCase();
		return flipped + name.slice(1);
	}

	isTag(key: string): boolean {
		return this.tagKeys.has(key);
	}

	/** The key `name` spells, exactly or with the first letter in the other case. */
	resolve(name: string): string | undefined {
		return this.resolveIn(name, this.all);
	}

	resolveRoute(name: string): string | undefined {
		return this.resolveIn(name, this.routeKeys);
	}

	resolveTag(name: string): string | undefined {
		return this.resolveIn(name, this.tagKeys);
	}

	/** The key `name` only differs from beyond the first letter's case, when `name` doesn't spell a key. */
	nearMiss(name: string): string | undefined {
		if (this.resolve(name) !== undefined) return undefined;
		const lower = name.toLowerCase();
		return [...this.all].find((key) => key.toLowerCase() === lower);
	}

	private resolveIn(
		name: string,
		keys: ReadonlySet<string>
	): string | undefined {
		if (name === "") return undefined;
		if (keys.has(name)) return name;
		const flipped = DeclaredKeys.flipFirstLetter(name);
		return keys.has(flipped) ? flipped : undefined;
	}
}

/** The Rojo project file a config builds on top of. */
export class ResolvedTemplate {
	constructor(
		readonly file: string,
		readonly project: RojoProject<ParsedProjectFile>
	) {}

	equals(other: ResolvedTemplate | undefined): boolean {
		return (
			other !== undefined &&
			this.file === other.file &&
			safeStringify(this.project.getTree()) ===
				safeStringify(other.project.getTree())
		);
	}
}

export interface ResolvedConfigFields {
	/** The config file itself, the leaf of its `extends` chain. */
	readonly file: string;
	/** The configs it extends, the nearest first. */
	readonly parents: readonly string[];
	/** Tags turned on or off from the command line that this config doesn't declare. */
	readonly skippedTags: readonly string[];
	readonly name: string;
	readonly rootDirs: readonly string[];
	/** In declaration order. */
	readonly routes: ReadonlyMap<string, Target>;
	/** Tag name to whether it is on. */
	readonly tags: Readonly<Record<string, boolean>>;
	readonly exclude: readonly string[];
	readonly template?: ResolvedTemplate;
	readonly syncDir?: string;
	readonly outFile: string;
}

/** A config with its layers merged and validated: every path is absolute and every route target is parsed. */
export class ResolvedConfig {
	readonly file: string;
	readonly parents: readonly string[];
	readonly skippedTags: readonly string[];
	readonly name: string;
	readonly rootDirs: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly tags: Readonly<Record<string, boolean>>;
	readonly exclude: readonly string[];
	readonly template?: ResolvedTemplate;
	readonly syncDir?: string;
	readonly outFile: string;
	readonly keys: DeclaredKeys;

	constructor(fields: ResolvedConfigFields) {
		this.file = fields.file;
		this.parents = fields.parents;
		this.skippedTags = fields.skippedTags;
		this.name = fields.name;
		this.rootDirs = fields.rootDirs;
		this.routes = fields.routes;
		this.tags = fields.tags;
		this.exclude = fields.exclude;
		this.template = fields.template;
		this.syncDir = fields.syncDir;
		this.outFile = fields.outFile;
		this.keys = new DeclaredKeys(
			fields.routes.keys(),
			Object.keys(fields.tags)
		);
	}

	/** What the config is asked for by. */
	get label(): string {
		return configLabel(this.file);
	}

	/** The directory the project file is written to, and every path in it is relative to. */
	get projectDir(): string {
		return path.dirname(this.outFile);
	}

	/** The deepest directory holding every root dir, or `undefined` without any. */
	get commonRoot(): string | undefined {
		return this.rootDirs.length > 0
			? commonAncestor(this.rootDirs)
			: undefined;
	}

	/** The tags that are on. */
	get enabledTags(): string[] {
		return Object.keys(this.tags).filter((tag) => this.tags[tag]);
	}
}
