import path from "path";
import { formatJsonFile, safeStringify } from "../../base/json.js";
import { commonAncestor, isInside, toPosix } from "../../base/path.js";
import {
	OptionDescriptor,
	OptionValues,
} from "../../platform/environment/args.js";
import { Target } from "../roblox/roblox.js";
import {
	NodeClash,
	PROJECT_SUFFIX,
	ParsedProjectFile,
	RojoProject,
	projectFileName,
} from "../rojo/rojo-project.js";

/** What a mode changes about a build: which variants it turns on and which files are left out. */
export interface ModeConfig {
	readonly variants?: string[];
	readonly exclude?: string[];
}

export interface RogenConfig {
	readonly $schema?: string;
	readonly extends?: string;
	readonly rootDirs?: string[];
	readonly routes?: Record<string, string>;
	readonly variants?: string[];
	readonly conflicts?: string[][];
	readonly modes?: Record<string, ModeConfig>;
	readonly mode?: string;
	readonly exclude?: string[];
	readonly template?: string;
	readonly syncDir?: string;
	readonly outFile?: string;
}

const VariantOption = {
	name: "variant",
	type: "string",
	placeholder: "name",
	multiple: true,
	description: "Turns a variant on, beyond those the mode lists.",
} as const satisfies OptionDescriptor;

const NoVariantOption = {
	name: "no-variant",
	type: "string",
	placeholder: "name",
	multiple: true,
	description: "Turns a variant off, whatever turned it on.",
} as const satisfies OptionDescriptor;

export const ModeOption = {
	name: "mode",
	type: "string",
	placeholder: "name",
	description: "Picks the mode every config that declares modes builds in.",
} as const satisfies OptionDescriptor;

/** The flags that say which mode is active and which variants are on in the configs a command reads. */
export const ConfigSelectionOptions = [
	ModeOption,
	VariantOption,
	NoVariantOption,
] as const satisfies readonly OptionDescriptor[];

export const OutFileOption = {
	name: "out-file",
	short: "o",
	type: "string",
	placeholder: "path",
	description: "Overrides outFile, for one config.",
} as const satisfies OptionDescriptor;

/** The flags that override the configs a command builds. */
export const ConfigOptions = [
	OutFileOption,
	ModeOption,
	VariantOption,
	NoVariantOption,
] as const satisfies readonly OptionDescriptor[];

/** What a command line says about the configs to read; `ConfigSelectionOptions` give a part of it. */
export type ConfigOptionValues = OptionValues<typeof ConfigOptions>;

export const CONFIG_SUFFIX = ".rogen.json";
export const DEFAULT_CONFIG_STEM = "default";

export const configFileName = (stem: string): string =>
	`${stem}${CONFIG_SUFFIX}`;

/** The config a project starts with. */
export const DEFAULT_CONFIG_FILE = configFileName(DEFAULT_CONFIG_STEM);

/** Whether `fileName` is the name of a config file. */
export const isConfigFileName = (fileName: string): boolean =>
	fileName.endsWith(CONFIG_SUFFIX);

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
	// Compared as paths, since a case-insensitive file system makes `src` and `Src` one folder.
	const first = rootDirs.findIndex(
		(other) => path.relative(other, rootDir) === ""
	);
	if (first !== index) return { kind: "duplicate" };
	const outer = rootDirs.find((other) => isInside(rootDir, other));
	return outer === undefined ? undefined : { kind: "nested", outer };
}

/** The route, variant and mode keys a config declares; a name spells a key exactly or with its first letter flipped. */
export class DeclaredKeys {
	/** The route that takes every file no other route claims. */
	static readonly FALLBACK_ROUTE = "*";

	static readonly NAME = /^[A-Za-z][A-Za-z0-9]*$/;

	/** Every route key but the fallback, which no name can spell. */
	readonly routeKeys: ReadonlySet<string>;
	/** The keys that mark a file as one alternative of an instance: variants and modes. */
	readonly variantKeys: ReadonlySet<string>;
	readonly modeKeys: ReadonlySet<string>;
	readonly all: ReadonlySet<string>;

	constructor(
		routeKeys: Iterable<string>,
		variantKeys: Iterable<string>,
		modeKeys: Iterable<string> = []
	) {
		this.routeKeys = new Set(
			[...routeKeys].filter((key) => key !== DeclaredKeys.FALLBACK_ROUTE)
		);
		this.modeKeys = new Set(modeKeys);
		this.variantKeys = new Set([...variantKeys, ...this.modeKeys]);
		this.all = new Set([...this.routeKeys, ...this.variantKeys]);
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

	/** Whether `key` marks a file as an alternative, as a variant or a mode does. */
	isVariant(key: string): boolean {
		return this.variantKeys.has(key);
	}

	isMode(key: string): boolean {
		return this.modeKeys.has(key);
	}

	isRoute(key: string): boolean {
		return this.routeKeys.has(key);
	}

	/** What `key` is, in the words a message names it. */
	kindOf(key: string): "mode" | "variant" | "route" {
		return this.isMode(key)
			? "mode"
			: this.isVariant(key)
				? "variant"
				: "route";
	}

	/** The key `name` spells, exactly or with the first letter in the other case. */
	resolve(name: string): string | undefined {
		return this.resolveIn(name, this.all);
	}

	resolveRoute(name: string): string | undefined {
		return this.resolveIn(name, this.routeKeys);
	}

	resolveVariant(name: string): string | undefined {
		return this.resolveIn(name, this.variantKeys);
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
		let rebased = base.project;
		if (from !== to) {
			const globs = rebased.globIgnorePaths;
			rebased = new RojoProject({
				...rebased.getTree(),
				...(globs.length > 0 && { globIgnorePaths: globs.map(rebase) }),
			});
			rebased.mapPaths(rebase);
		}
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
			safeStringify(this.project.getTree()) ===
				safeStringify(other.project.getTree())
		);
	}
}

/** A mode's effect on a config: the globs it leaves out, and every declared variant to whether the mode lists it, with the command line left out. */
export interface ModeView {
	readonly variants: Readonly<Record<string, boolean>>;
	readonly exclude: readonly string[];
}

export interface ResolvedConfigFields {
	/** The config file itself, the leaf of its `extends` chain. */
	readonly file: string;
	/** The configs it extends, the nearest first. */
	readonly parents: readonly string[];
	/** Variants turned on or off from the command line that this config doesn't declare. */
	readonly skippedVariants: readonly string[];
	readonly name: string;
	readonly rootDirs: readonly string[];
	/** In declaration order. */
	readonly routes: ReadonlyMap<string, Target>;
	/** Every declared variant to whether it is on, in the active mode with the command line applied. */
	readonly variants: Readonly<Record<string, boolean>>;
	/** Groups of variants of which at most one is on. */
	readonly conflicts?: readonly (readonly string[])[];
	/** The globs left out in the active mode, which drop scanned files and template mounts alike. */
	readonly exclude: readonly string[];
	/** The active mode; none when the config declares no modes. */
	readonly mode?: string;
	/** Every mode the config declares, in declaration order; none by default. */
	readonly modeViews?: ReadonlyMap<string, ModeView>;
	readonly template?: ResolvedTemplate;
	readonly syncDir?: string;
	readonly outFile: string;
}

/** A config with its layers merged and validated: every path is absolute and every route target is parsed. */
export class ResolvedConfig {
	readonly file: string;
	readonly parents: readonly string[];
	readonly skippedVariants: readonly string[];
	readonly name: string;
	readonly rootDirs: readonly string[];
	readonly routes: ReadonlyMap<string, Target>;
	readonly variants: Readonly<Record<string, boolean>>;
	readonly exclude: readonly string[];
	readonly mode?: string;
	readonly modes: readonly string[];
	readonly conflicts: readonly (readonly string[])[];
	readonly template?: ResolvedTemplate;
	readonly syncDir?: string;
	readonly outFile: string;
	readonly keys: DeclaredKeys;
	private readonly switches: Readonly<Record<string, boolean>>;

	constructor(private readonly fields: ResolvedConfigFields) {
		this.file = fields.file;
		this.parents = fields.parents;
		this.skippedVariants = fields.skippedVariants;
		this.name = fields.name;
		this.rootDirs = fields.rootDirs;
		this.routes = fields.routes;
		this.variants = fields.variants;
		this.exclude = fields.exclude;
		this.mode = fields.mode;
		this.conflicts = fields.conflicts ?? [];
		this.modes = [...(fields.modeViews?.keys() ?? [])];
		this.template = fields.template;
		this.syncDir = fields.syncDir;
		this.outFile = fields.outFile;
		this.keys = new DeclaredKeys(
			fields.routes.keys(),
			Object.keys(fields.variants),
			this.modes
		);
		this.switches = {
			...fields.variants,
			...Object.fromEntries(
				this.modes.map((mode) => [mode, mode === fields.mode])
			),
		};
	}

	/** The same config with `mode` active, or `undefined` when it declares no such mode. */
	inMode(mode: string): ResolvedConfig | undefined {
		const view = this.fields.modeViews?.get(mode);
		return (
			view &&
			new ResolvedConfig({
				...this.fields,
				mode,
				variants: view.variants,
				exclude: view.exclude,
			})
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

	/** The variants and modes among a file's that are off; a file that carries any is pruned. */
	dormantVariants<T extends { readonly variant: string }>(
		matches: readonly T[]
	): T[] {
		return matches.filter(({ variant }) => !this.switches[variant]);
	}

	/** Whether every variant among a file's is on; otherwise it is pruned. */
	allVariantsOn<T extends { readonly variant: string }>(
		matches: readonly T[]
	): boolean {
		return this.dormantVariants(matches).length === 0;
	}
}
