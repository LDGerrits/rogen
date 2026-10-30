import { Casing, LayoutSettings } from "./legacy-keywords.js";

/** A v1 mode: the project file it wrote, and the folder its `$path`s pointed into. */
export interface LegacyMode {
	readonly name: string;
	readonly output: string;
	readonly build: string;
	readonly globIgnorePaths: readonly string[];
	readonly tags: Readonly<Record<string, boolean>>;
}

/** v1's own modes, with the defaults a config's mode was merged over. */
const BUILT_IN_MODES: Readonly<Record<string, Omit<LegacyMode, "name">>> = {
	luau: {
		output: "default.project.json",
		build: "src",
		globIgnorePaths: [],
		tags: {},
	},
	ts: {
		output: "default.project.json",
		build: "out",
		globIgnorePaths: [],
		tags: {},
	},
	darklua: {
		output: "build.project.json",
		build: "dist",
		globIgnorePaths: [],
		tags: {},
	},
};

const SETTINGS_KEYS = new Set([
	"source",
	"tags",
	"verbatim",
	"casing",
	"unwrap",
	"aliases",
	"globIgnorePaths",
	"project",
]);

type Fields = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Fields =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string"
			? [value]
			: [];

const booleans = (value: unknown): Record<string, boolean> =>
	isObject(value)
		? Object.fromEntries(
				Object.entries(value).filter(
					(entry): entry is [string, boolean] =>
						typeof entry[1] === "boolean"
				)
			)
		: {};

const words = (value: unknown): Record<string, string> =>
	isObject(value)
		? Object.fromEntries(
				Object.entries(value).filter(
					(entry): entry is [string, string] =>
						typeof entry[1] === "string"
				)
			)
		: {};

/** What a v1 config said, with v1's defaults for what it left out. */
export class LegacySettings {
	readonly source: readonly string[];
	readonly casing: Casing;
	readonly verbatim: boolean;
	readonly unwrap: boolean;
	readonly aliases: Readonly<Record<string, string>>;
	readonly tags: Readonly<Record<string, boolean>>;
	readonly globIgnorePaths: readonly string[];
	/** The base project: inline, the path of a file, or none for v1's fallback. */
	readonly project: Fields | string | undefined;
	/** Every mode the config has, v1's own first; which ones ran depends on the folder. */
	readonly modes: readonly LegacyMode[];

	constructor(fields: Fields) {
		const source = strings(fields.source);
		this.source = source.length > 0 ? source : ["src"];
		this.casing = LegacySettings.casingOf(fields.casing);
		this.verbatim = fields.verbatim === true;
		this.unwrap = fields.unwrap === true;
		this.aliases = words(fields.aliases);
		this.tags = booleans(fields.tags);
		this.globIgnorePaths = strings(fields.globIgnorePaths);
		this.project =
			isObject(fields.project) || typeof fields.project === "string"
				? fields.project
				: undefined;
		this.modes = LegacySettings.modesOf(fields);
	}

	layout(emitLegacyScripts: boolean): LayoutSettings {
		return { casing: this.casing, unwrap: this.unwrap, emitLegacyScripts };
	}

	/** The tags a v1 build knew, in lower case. */
	get knownTags(): ReadonlySet<string> {
		return new Set(Object.keys(this.tags).map((tag) => tag.toLowerCase()));
	}

	private static casingOf(value: unknown): Casing {
		const normalised =
			typeof value === "string"
				? value.toLowerCase().replace(/[-_\s]/g, "")
				: "";
		return normalised === "pascal" || normalised === "pascalcase"
			? "PascalCase"
			: "camelCase";
	}

	private static modesOf(fields: Fields): LegacyMode[] {
		const builtIn = Object.entries(BUILT_IN_MODES).map(
			([name, defaults]) => {
				const given = isObject(fields[name]) ? fields[name] : {};
				return LegacySettings.modeOf(name, given, defaults);
			}
		);
		const custom = Object.entries(fields)
			.filter(
				([name, value]) =>
					!SETTINGS_KEYS.has(name) &&
					!(name in BUILT_IN_MODES) &&
					isObject(value) &&
					typeof value.output === "string" &&
					typeof value.build === "string"
			)
			.map(([name, value]) =>
				LegacySettings.modeOf(name, value as Fields, undefined)
			);
		return [...builtIn, ...custom];
	}

	private static modeOf(
		name: string,
		given: Fields,
		defaults: Omit<LegacyMode, "name"> | undefined
	): LegacyMode {
		return {
			name,
			output:
				typeof given.output === "string"
					? given.output
					: (defaults?.output ?? ""),
			build:
				typeof given.build === "string"
					? given.build
					: (defaults?.build ?? ""),
			globIgnorePaths: strings(given.globIgnorePaths),
			tags: booleans(given.tags),
		};
	}
}
