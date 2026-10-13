import path from "path";
import { formatJsonFile, safeStringify } from "../../base/json.js";
import {
	PathSet,
	commonAncestor,
	isInside,
	samePath,
	toPosix,
} from "../../base/path.js";
import { ignoresPathCase } from "../../base/platform.js";
import { Target } from "../roblox/roblox.js";
import {
	NodeClash,
	ParsedProjectFile,
	RojoProject,
} from "../rojo/rojo-project.js";

/** The sync servers a config can pick for `rogen serve`; each is the id of a `SyncServer`. */
export const SERVER_NAMES = ["rojo", "argon"] as const;
export type ServerName = (typeof SERVER_NAMES)[number];

export const isServerName = (name: string): name is ServerName =>
	(SERVER_NAMES as readonly string[]).includes(name);

export interface RogenConfig {
	readonly $schema?: string;
	readonly extends?: string;
	readonly rootDirs?: string[];
	readonly routes?: Record<string, string>;
	readonly exclude?: string[];
	readonly template?: string;
	readonly syncDir?: string;
	readonly outFile?: string;
	readonly server?: string;
}

/** Anything that holds config values by field name, such as a config model or the chain of them. */
export interface ConfigValues {
	getValue<T>(section?: string | readonly string[]): T | undefined;
}

/** What `values` holds under the top-level field `key`, typed as the config declares it. */
export function fieldOf<K extends keyof RogenConfig>(
	values: ConfigValues,
	key: K
): RogenConfig[K] {
	return values.getValue<RogenConfig[K]>(key);
}

export const CONFIG_SUFFIX = ".rogen.json";
export const DEFAULT_CONFIG_STEM = "default";

export const configFileName = (stem: string): string =>
	`${stem}${CONFIG_SUFFIX}`;

/** The config a project starts with. */
export const DEFAULT_CONFIG_FILE = configFileName(DEFAULT_CONFIG_STEM);

/** Whether `fileName` is the name of a config file. */
export const isConfigFileName = (fileName: string): boolean =>
	fileName.endsWith(CONFIG_SUFFIX);

/** A config as the relations between configs see it: its file and the files of its `extends` chain, nearest first. */
interface ExtendingConfig {
	readonly file: string;
	readonly parents: readonly string[];
}

/** The configs of `configs` that no other of them extends, which a serve starts a server for: the synced config over its source-rooted base, and each place over the config they share. A file counts as one however its path is written, as `extends` may spell it differently than the folder lists it. */
export function leafConfigs<T extends ExtendingConfig>(
	configs: readonly T[],
	caseInsensitive = ignoresPathCase
): T[] {
	const extended = new PathSet(
		configs.flatMap(({ parents }) => parents),
		caseInsensitive
	);
	return configs.filter(({ file }) => !extended.has(file));
}

/** Whether `config` is one of `files` or extends one of them, however far down its chain. */
export function inFamilyOf(config: ExtendingConfig, files: PathSet): boolean {
	return files.has(config.file) || config.parents.some((p) => files.has(p));
}

/** The configs of `configs` whose nearest parent is `config`. */
export function directExtendersOf<T extends ExtendingConfig>(
	config: ExtendingConfig,
	configs: readonly T[],
	caseInsensitive = ignoresPathCase
): T[] {
	const file = new PathSet([config.file], caseInsensitive);
	return configs.filter(
		({ parents }) => parents.length > 0 && file.has(parents[0])
	);
}

/** The name a config is asked for by, e.g. `lobby` for `lobby.rogen.json`. */
export const configLabel = (file: string): string =>
	path.basename(file, CONFIG_SUFFIX);

const SCHEMA_BASE_URL = "https://ldgerrits.github.io/rogen/schema";

/** The schema a config written by this release points at. */
export const SCHEMA_URL = schemaUrlFor("2.0.0-beta.1");

/** Where a release's configs point: its major, except a pre-release of a later minor or patch, which may add fields its major doesn't have yet. */
export function schemaChannel(version: string): string {
	const exact = version.includes("-") && !/^\d+\.0\.0-/.test(version);
	return exact ? version : version.split(".")[0];
}

export function schemaUrlFor(version: string): string {
	return `${SCHEMA_BASE_URL}/${schemaChannel(version)}/rogen.json`;
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
	const first = rootDirs.findIndex((other) => samePath(other, rootDir));
	if (first !== index) return { kind: "duplicate" };
	const outer = rootDirs.find((other) => isInside(rootDir, other));
	return outer === undefined ? undefined : { kind: "nested", outer };
}

/** The route keys a config declares; a name spells a key exactly or with its first letter flipped. */
export class DeclaredKeys {
	/** The route that takes every file no other route claims. */
	static readonly FALLBACK_ROUTE = "*";

	static readonly NAME = /^[A-Za-z][A-Za-z0-9]*$/;

	/** Every route key but the fallback, which no name can spell. */
	readonly routeKeys: ReadonlySet<string>;

	constructor(routeKeys: Iterable<string>) {
		this.routeKeys = new Set(
			[...routeKeys].filter((key) => key !== DeclaredKeys.FALLBACK_ROUTE)
		);
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

	isRoute(key: string): boolean {
		return this.routeKeys.has(key);
	}

	/** The key `name` spells, exactly or with the first letter in the other case. */
	resolve(name: string): string | undefined {
		return this.resolveIn(name, this.routeKeys);
	}

	/** The key `name` only differs from beyond the first letter's case, when `name` doesn't spell a key. */
	nearMiss(name: string): string | undefined {
		if (this.resolve(name) !== undefined) return undefined;
		const lower = name.toLowerCase();
		return [...this.routeKeys].find((key) => key.toLowerCase() === lower);
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

/** A field a template sets on a node that the template it merges over sets differently. */
export interface TemplateClash extends NodeClash {
	/** The template whose value won. */
	readonly file: string;
	/** The template whose value lost. */
	readonly base: string;
}

/** The Rojo project file a config builds on top of: the nearest template its chain names, merged over the ones above it. */
export class ResolvedTemplate {
	constructor(
		readonly file: string,
		/** Every `$path` and glob is relative to `file`'s directory. */
		readonly project: RojoProject<ParsedProjectFile>,
		/** The templates it is merged over, the furthest first. */
		readonly bases: readonly string[] = [],
		readonly clashes: readonly TemplateClash[] = []
	) {}

	/** This template merged over `base`, whose paths are rebased to this one's directory. */
	over(base: ResolvedTemplate): ResolvedTemplate {
		const from = path.dirname(base.file);
		const to = path.dirname(this.file);
		const rebase = (target: string) =>
			toPosix(path.relative(to, path.resolve(from, target)));
		const rebased =
			from === to ? base.project : base.project.rebased(rebase);
		const { project, clashes } = rebased.overlaidWith(this.project);
		return new ResolvedTemplate(
			this.file,
			project,
			[...base.bases, base.file],
			[
				...base.clashes,
				...clashes.map((clash) => ({
					...clash,
					file: this.file,
					base: base.file,
				})),
			]
		);
	}

	equals(other: ResolvedTemplate | undefined): boolean {
		return (
			other !== undefined &&
			this.file === other.file &&
			safeStringify(this.project.getFile()) ===
				safeStringify(other.project.getFile())
		);
	}
}

export interface ResolvedConfigFields {
	/** The config file itself, the leaf of its `extends` chain. */
	readonly file: string;
	/** The configs it extends, the nearest first. */
	readonly parents: readonly string[];
	readonly projectName: string;
	readonly rootDirs: readonly string[];
	/** In declaration order. */
	readonly routes: ReadonlyMap<string, Target>;
	/** The globs left out, which drop scanned files and template mounts alike. */
	readonly exclude: readonly string[];
	readonly template?: ResolvedTemplate;
	readonly syncDir?: string;
	readonly outFile: string;
	/** The sync server `rogen serve` starts for it; the one the project pins when not set. */
	readonly server?: string;
}

/** A config with its layers merged and validated: every path is absolute and every route target is parsed. */
export class ResolvedConfig {
	readonly file: string;
	readonly parents: readonly string[];
	readonly projectName: string;
	readonly rootDirs: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly exclude: readonly string[];
	readonly template?: ResolvedTemplate;
	readonly syncDir?: string;
	readonly outFile: string;
	readonly server?: string;
	readonly keys: DeclaredKeys;

	constructor(fields: ResolvedConfigFields) {
		this.file = fields.file;
		this.parents = fields.parents;
		this.projectName = fields.projectName;
		this.rootDirs = fields.rootDirs;
		this.routes = fields.routes;
		this.exclude = fields.exclude;
		this.template = fields.template;
		this.syncDir = fields.syncDir;
		this.outFile = fields.outFile;
		this.server = fields.server;
		this.keys = new DeclaredKeys(fields.routes.keys());
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
}
