import path from "path";
import { JSONSchema } from "../../base/json-schema.js";
import { joinPosix, stemOf } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	FileType,
	isDirectoryType,
} from "../../platform/fs/file-system-service.js";
import { JsoncDocumentReader } from "../../platform/jsonc/jsonc-document-reader.js";
import { ScriptRun } from "../roblox/roblox.js";
import { RojoNode } from "./rojo-project.js";
import {
	SyncRule,
	SyncRuleMatch,
	SyncRuleUse,
	SyncRules,
} from "./sync-rules.js";

export type RojoFileKind = "script" | "model" | "data";

const SCRIPT_SUFFIXES = ["server", "client", "plugin"] as const;

export type RojoScriptSuffix = (typeof SCRIPT_SUFFIXES)[number];

export const RUN_SCRIPT_SUFFIXES: ReadonlySet<string> = new Set([
	"server",
	"client",
]);

const KIND_OF_USE: Readonly<Record<SyncRuleUse, RojoFileKind | undefined>> = {
	serverScript: "script",
	clientScript: "script",
	pluginScript: "script",
	moduleScript: "script",
	legacyClientScript: "script",
	legacyServerScript: "script",
	runContextServerScript: "script",
	runContextClientScript: "script",
	rbxm: "model",
	rbxmx: "model",
	project: "data",
	jsonModel: "data",
	json: "data",
	toml: "data",
	csv: "data",
	text: "data",
	yaml: "data",
	ignore: undefined,
};

const SCRIPT_SUFFIX_OF_USE: Readonly<
	Partial<Record<SyncRuleUse, RojoScriptSuffix>>
> = {
	serverScript: "server",
	legacyServerScript: "server",
	runContextServerScript: "server",
	clientScript: "client",
	legacyClientScript: "client",
	runContextClientScript: "client",
	pluginScript: "plugin",
};

const COMPILER_EXTENSIONS: readonly string[] = [".ts", ".tsx"];
const INIT_FILE = /^init(\.(server|client|plugin))?\.luau?$/;

export class RojoFile {
	static readonly SCRIPT_EXTENSIONS: readonly string[] = [
		".luau",
		".lua",
		...COMPILER_EXTENSIONS,
	];
	static readonly META_SUFFIX = ".meta.json";
	/** Rojo reads this over `.meta.json` when a file has both. */
	static readonly META_SUFFIX_JSONC = ".meta.jsonc";
	static readonly INIT_NAME = "init";
	static readonly INIT_META = `${RojoFile.INIT_NAME}${RojoFile.META_SUFFIX}`;
	static readonly INIT_META_JSONC = `${RojoFile.INIT_NAME}${RojoFile.META_SUFFIX_JSONC}`;

	readonly stem: string;
	private readonly match: SyncRuleMatch | undefined;

	/** `dir` is the folder the file sits in, relative to the one the sync rules are written for. */
	constructor(
		readonly name: string,
		private readonly rules: SyncRules,
		private readonly dir = ""
	) {
		this.match = INIT_FILE.test(name)
			? SyncRules.DEFAULT.match(name)
			: rules.match(joinPosix(dir, name));
		this.stem = this.ownMatch ? this.ownMatch.name : stemOf(name);
	}

	/** The file at `source`, an absolute POSIX path, as Rojo reads it with `rules`, which are written for a folder. */
	static at(source: string, rules: SyncRules): RojoFile {
		return new RojoFile(
			path.posix.basename(source),
			rules,
			rules.relativeDir(path.posix.dirname(source))
		);
	}

	/** The match of a rule the project wrote. */
	private get ownMatch(): SyncRuleMatch | undefined {
		return this.match?.own ? this.match : undefined;
	}

	/** The rule the project wrote that takes this file. */
	get ownRule(): SyncRule | undefined {
		return this.ownMatch?.rule;
	}

	/** The rule of the project that takes this file as an `ignore`: Rojo reads nothing of it. */
	get ignoredBy(): SyncRule | undefined {
		return this.ownRule?.use === "ignore" ? this.ownRule : undefined;
	}

	/** The rule of the project that takes this file but whose suffix does not end its name, so Rojo names the instance by the whole file name. */
	get suffixMissedBy(): SyncRule | undefined {
		return this.ownMatch?.suffixMissed ? this.ownMatch.rule : undefined;
	}

	static scriptSuffixOf(stem: string): RojoScriptSuffix | undefined {
		return SCRIPT_SUFFIXES.find((suffix) => stem.endsWith(`.${suffix}`));
	}

	static scriptNameOf(stem: string): string {
		const suffix = RojoFile.scriptSuffixOf(stem);
		return suffix ? stem.slice(0, -(suffix.length + 1)) : stem;
	}

	/** Rojo reads `.model.json` and `.project.json` as a model and a nested project. */
	static dataNameOf(stem: string): string {
		return stem.replace(/(?<=.)\.(model|project)$/, "");
	}

	static metaStemOf(fileName: string): string | undefined {
		for (const suffix of [RojoFile.META_SUFFIX_JSONC, RojoFile.META_SUFFIX])
			if (fileName.endsWith(suffix))
				return fileName.slice(0, -suffix.length);
		return undefined;
	}

	static isInitMeta(fileName: string): boolean {
		return (
			fileName === RojoFile.INIT_META ||
			fileName === RojoFile.INIT_META_JSONC
		);
	}

	get isMeta(): boolean {
		return RojoFile.metaStemOf(this.name) !== undefined;
	}

	/** The name with its extension lowercased when only that keeps Rojo from reading the file: Rojo ignores `Foo.LUAU`. */
	get lowercasedExtension(): string | undefined {
		if (this.kind !== undefined || this.isMeta) return undefined;
		if (this.name.toLowerCase().endsWith(".d.ts")) return undefined;
		const fixed = this.name.replace(
			/(\.(?:meta|model|project))?\.[^.]+$/i,
			(suffix) => suffix.toLowerCase()
		);
		if (fixed === this.name) return undefined;
		const lowercased = new RojoFile(fixed, this.rules, this.dir);
		return lowercased.kind !== undefined || lowercased.isMeta
			? fixed
			: undefined;
	}

	get kind(): RojoFileKind | undefined {
		if (this.name.endsWith(".d.ts") || this.isMeta) return undefined;

		if (COMPILER_EXTENSIONS.includes(path.extname(this.name)))
			return "script";
		return this.match && KIND_OF_USE[this.match.rule.use];
	}

	/** Whether Rojo reads the file as a nested project. */
	get isProject(): boolean {
		return this.match?.rule.use === "project";
	}

	/** Whether the file is Luau source: a script by a rule of the project, else by its extension. */
	get isLuau(): boolean {
		if (this.ownMatch) return this.kind === "script";
		const extension = path.extname(this.name);
		return extension === ".luau" || extension === ".lua";
	}

	get isLuauModule(): boolean {
		return this.isLuau && this.scriptSuffix === undefined;
	}

	/** The script class Rojo reads from the file name, or from the rule of the project that takes it; none for a module and any other file. */
	get scriptSuffix(): RojoScriptSuffix | undefined {
		if (this.kind !== "script") return undefined;
		return this.ownMatch
			? SCRIPT_SUFFIX_OF_USE[this.ownMatch.rule.use]
			: RojoFile.scriptSuffixOf(this.stem);
	}

	/** Whether a rule of the project cut the name, so no script suffix is left on it to strip. */
	get nameCutByRule(): boolean {
		return this.ownMatch !== undefined;
	}

	get isInit(): boolean {
		return INIT_FILE.test(this.name);
	}

	get instanceName(): string {
		if (this.ownMatch) return this.stem;
		if (this.kind === "script") return RojoFile.scriptNameOf(this.stem);
		if (this.kind !== "data") return this.stem;
		return this.isJson && this.stem.endsWith(".model")
			? this.stem.slice(0, -".model".length)
			: this.stem;
	}

	/** Rojo only reads `.model` and `.project` as a suffix on `.json` files. */
	get dataName(): string {
		return this.isJson && !this.ownMatch
			? RojoFile.dataNameOf(this.stem)
			: this.stem;
	}

	private get isJson(): boolean {
		return [".json", ".jsonc"].includes(path.extname(this.name));
	}

	get metaName(): string | undefined {
		if (this.kind === "script") return this.instanceName;
		if (this.kind === "data" && this.dataName === this.stem) {
			return this.stem;
		}
		return undefined;
	}

	get metaFiles(): string[] {
		const name = this.metaName;
		return name === undefined
			? []
			: [RojoFile.META_SUFFIX_JSONC, RojoFile.META_SUFFIX].map(
					(suffix) => `${name}${suffix}`
				);
	}

	get metaFile(): string | undefined {
		const name = this.metaName;
		return name === undefined
			? undefined
			: `${name}${RojoFile.META_SUFFIX}`;
	}
}

export interface RojoMetaFields {
	readonly className?: string;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly attributes?: Readonly<Record<string, unknown>>;
	readonly ignoreUnknownInstances?: boolean;
	readonly id?: string;
}

const BYTE_ORDER_MARK = "\uFEFF";

const META_SCHEMA: JSONSchema = {
	type: "object",
	// Rojo ignores fields it doesn't know, such as `$schema`.
	properties: {
		className: { type: "string" },
		properties: { type: "object" },
		attributes: { type: "object" },
		ignoreUnknownInstances: { type: "boolean" },
		id: { type: "string" },
	},
};

export interface ParsedMeta {
	readonly fields: RojoMetaFields;
	readonly typos: readonly Diagnostic[];
}

export class RojoMeta {
	private static readonly documents = new JsoncDocumentReader({
		codePrefix: "meta",
		noun: "a meta file",
	});

	/** Warns of each field that looks like a slip for one Rojo reads; the error is why Rojo would refuse `file`. */
	static parse(text: string, file: string): Result<ParsedMeta, Diagnostic[]> {
		if (text.startsWith(BYTE_ORDER_MARK))
			return err([
				errorDiagnostic(
					"meta.byteOrderMark",
					{ resource: file, position: { line: 1, column: 1 } },
					"starts with a byte order mark, which Rojo can't read, so it refuses the project. Save the file as UTF-8 without one."
				),
			]);
		const document = RojoMeta.documents.read(text, file, META_SCHEMA);
		if (document.isErr()) return err(document.error);

		const { root, value } = document.value;
		const known = Object.keys(META_SCHEMA.properties ?? {});
		return ok({
			fields: Object.fromEntries(
				known
					.filter((key) => value[key] !== undefined)
					.map((key) => [key, value[key]])
			) as RojoMetaFields,
			typos: root.properties.flatMap(({ name, line, column }) => {
				const suggestion = known.includes(name)
					? undefined
					: closestMatch(name, known);
				return suggestion
					? [
							warningDiagnostic(
								"meta.unknownField",
								{ resource: file, position: { line, column } },
								`unknown field "${name}"; Rojo ignores it. Did you mean "${suggestion}"?`
							),
						]
					: [];
			}),
		});
	}

	/** Applies `over` after `base`, as Rojo applies a `.meta.jsonc` after a `.meta.json`; properties merge. */
	static merged(base: RojoMetaFields, over: RojoMetaFields): RojoMetaFields {
		return {
			...base,
			...over,
			...((base.properties || over.properties) && {
				properties: { ...base.properties, ...over.properties },
			}),
		};
	}

	/** The fields `meta` adds to `node`; a field the project sets wins. */
	static fieldsUnder(
		meta: RojoMetaFields,
		node: RojoNode
	): Partial<RojoNode> {
		const fields: Partial<RojoNode> = {};
		if (meta.className !== undefined && node.$className === undefined)
			fields.$className = meta.className;
		if (meta.properties !== undefined)
			fields.$properties = { ...meta.properties, ...node.$properties };
		if (meta.attributes !== undefined && node.$attributes === undefined)
			fields.$attributes = { ...meta.attributes };
		if (
			meta.ignoreUnknownInstances !== undefined &&
			node.$ignoreUnknownInstances === undefined
		)
			fields.$ignoreUnknownInstances = meta.ignoreUnknownInstances;
		if (meta.id !== undefined && node.$id === undefined)
			fields.$id = meta.id;
		return fields;
	}
}

const RUN_CONTEXTS: Readonly<Record<string, ScriptRun>> = {
	Legacy: "Script",
	Server: "Server",
	Client: "Client",
	Plugin: "Plugin",
};

/** How Rojo makes a `.server` or `.client` script run; `undefined` for any other. */
export function scriptRunOf(
	suffix: RojoScriptSuffix | undefined,
	legacyScripts: boolean,
	runContext: unknown
): ScriptRun | undefined {
	if (suffix === undefined || !RUN_SCRIPT_SUFFIXES.has(suffix))
		return undefined;
	if (suffix === "client" && legacyScripts) return "LocalScript";
	const set =
		typeof runContext === "string" ? RUN_CONTEXTS[runContext] : undefined;
	if (set) return set;
	if (legacyScripts) return "Script";
	return suffix === "server" ? "Server" : "Client";
}

/** What Rojo reads as children of an init script's directory: every directory and every other instance file. */
export function childrenBesideInit(
	listing: ReadonlyMap<string, FileType>,
	init: string,
	fileNamed: (name: string) => RojoFile
): string[] {
	return [...listing].flatMap(([name, type]) =>
		isDirectoryType(type) ||
		(name !== init && fileNamed(name).kind !== undefined)
			? [name]
			: []
	);
}
