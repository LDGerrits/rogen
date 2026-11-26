import path from "path";
import { JsonStructure } from "../../base/json-structure.js";
import { JsoncNode } from "../../base/jsonc.js";
import { getOwn, isObject } from "../../base/objects.js";
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
import { PropertyValues } from "./property-values.js";
import { RojoNode } from "./rojo-project.js";
import {
	SyncRule,
	SyncRuleMatch,
	SyncRuleUse,
	SyncRules,
} from "./sync-rules.js";

export type RojoFileKind = "script" | "model" | "data";

export const SCRIPT_SUFFIXES = ["server", "client", "plugin"] as const;

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

const LUAU_EXTENSIONS: readonly string[] = [".luau", ".lua"];

type Reading = "rojo" | "compiled";

export class RojoFile {
	static readonly META_SUFFIX = ".meta.json";
	static readonly META_SUFFIX_JSONC = ".meta.jsonc";
	static readonly INIT_NAME = "init";
	static readonly INIT_META = `${RojoFile.INIT_NAME}${RojoFile.META_SUFFIX}`;
	static readonly INIT_META_JSONC = `${RojoFile.INIT_NAME}${RojoFile.META_SUFFIX_JSONC}`;
	/**
	 * Rojo looks for a folder's init file in this order and reads the first
	 * it finds. A project's sync rules play no part, and `.plugin.lua` comes
	 * before `.plugin.luau`.
	 */
	static readonly INIT_FILES: ReadonlySet<string> = new Set([
		"init.luau",
		"init.lua",
		"init.server.luau",
		"init.server.lua",
		"init.client.luau",
		"init.client.lua",
		"init.plugin.lua",
		"init.plugin.luau",
		"init.csv",
	]);
	static readonly DEFAULT_PROJECTS: readonly string[] = [
		"default.project.json",
		"default.project.jsonc",
	];

	readonly stem: string;
	readonly isCompiled: boolean;
	private readonly match: SyncRuleMatch | undefined;
	readonly ownRule: SyncRule | undefined;
	private readonly spelledScriptSuffix: RojoScriptSuffix | undefined;

	constructor(
		readonly name: string,
		private readonly rules: SyncRules,
		private readonly dir = "",
		private readonly reading: Reading = "rojo"
	) {
		this.match = RojoFile.INIT_FILES.has(name)
			? SyncRules.DEFAULT.match(name)
			: rules.match(joinPosix(dir, name));
		this.isCompiled =
			reading === "compiled" &&
			this.match?.own === true &&
			KIND_OF_USE[this.match.rule.use] === "script" &&
			!LUAU_EXTENSIONS.includes(path.extname(name));
		this.ownRule =
			this.match?.own && !this.isCompiled ? this.match.rule : undefined;
		const run = this.ownRule && SCRIPT_SUFFIX_OF_USE[this.ownRule.use];
		const spelled =
			run &&
			!this.match?.suffixMissed &&
			this.ownRule?.suffix?.startsWith(`.${run}.`)
				? run
				: undefined;
		this.spelledScriptSuffix = spelled;
		this.stem =
			this.ownRule && this.match
				? `${this.match.name}${spelled ? `.${spelled}` : ""}`
				: stemOf(name);
	}

	static initReadFirst(names: Iterable<string>): string | undefined {
		const present = new Set(names);
		return [...RojoFile.INIT_FILES].find((name) => present.has(name));
	}

	static initOrderOf(name: string | undefined): number {
		const at = [...RojoFile.INIT_FILES].findIndex((init) => init === name);
		return at === -1 ? RojoFile.INIT_FILES.size : at;
	}

	static at(source: string, rules: SyncRules, reading?: Reading): RojoFile {
		return new RojoFile(
			path.posix.basename(source),
			rules,
			rules.relativeDir(path.posix.dirname(source)),
			reading
		);
	}

	get ignoredBy(): SyncRule | undefined {
		return this.ownRule?.use === "ignore" ? this.ownRule : undefined;
	}

	get suffixMissedBy(): SyncRule | undefined {
		return this.match?.suffixMissed ? this.ownRule : undefined;
	}

	static scriptSuffixOf(stem: string): RojoScriptSuffix | undefined {
		return SCRIPT_SUFFIXES.find((suffix) => stem.endsWith(`.${suffix}`));
	}

	static scriptNameOf(stem: string): string {
		const suffix = RojoFile.scriptSuffixOf(stem);
		return suffix ? stem.slice(0, -(suffix.length + 1)) : stem;
	}

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

	renamed(name: string): RojoFile {
		return new RojoFile(name, this.rules, this.dir, this.reading);
	}

	get uncompiled(): RojoFile {
		return new RojoFile(this.name, this.rules, this.dir);
	}

	/**
	 * The name with its extension lowercased when only that keeps Rojo from
	 * reading the file: Rojo ignores `Foo.LUAU`.
	 */
	get lowercasedExtension(): string | undefined {
		if (this.kind !== undefined || this.isMeta) return undefined;
		if (this.name.toLowerCase().endsWith(".d.ts")) return undefined;
		const fixed = this.name.replace(
			/(\.(?:meta|model|project))?\.[^.]+$/i,
			(suffix) => suffix.toLowerCase()
		);
		if (fixed === this.name) return undefined;
		const lowercased = this.renamed(fixed);
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

	get needsCompiler(): boolean {
		return (
			this.reading === "rojo" &&
			this.match?.own !== true &&
			this.kind === "script" &&
			COMPILER_EXTENSIONS.includes(path.extname(this.name))
		);
	}

	get isSyncedByRojo(): boolean {
		return (
			this.isMeta ||
			(this.match !== undefined && this.match.rule.use !== "ignore")
		);
	}

	get isProject(): boolean {
		return this.match?.rule.use === "project";
	}

	get isDefaultProject(): boolean {
		return RojoFile.DEFAULT_PROJECTS.includes(this.name);
	}

	get isCsv(): boolean {
		return this.match?.rule.use === "csv";
	}

	get isText(): boolean {
		return this.match?.rule.use === "text";
	}

	get isLuau(): boolean {
		if (this.match?.own) return this.kind === "script";
		return LUAU_EXTENSIONS.includes(path.extname(this.name));
	}

	get isLuauModule(): boolean {
		return this.isLuau && this.scriptSuffix === undefined;
	}

	get isDataModule(): boolean {
		const use = this.match?.rule.use;
		return use === "json" || use === "toml" || use === "yaml";
	}

	get scriptSuffix(): RojoScriptSuffix | undefined {
		if (this.kind !== "script") return undefined;
		return this.ownRule
			? SCRIPT_SUFFIX_OF_USE[this.ownRule.use]
			: RojoFile.scriptSuffixOf(this.stem);
	}

	get nameCutByRule(): boolean {
		return this.ownRule !== undefined && !this.spelledScriptSuffix;
	}

	get isInit(): boolean {
		return RojoFile.INIT_FILES.has(this.name);
	}

	get initOrder(): number {
		return RojoFile.initOrderOf(this.initFileOfKind);
	}

	private get initFileOfKind(): string | undefined {
		if (this.isCsv) return `${RojoFile.INIT_NAME}.csv`;
		const suffix = this.scriptSuffix;
		if (suffix === undefined && !this.isLuau) return undefined;
		const extension = path.extname(this.name) === ".lua" ? ".lua" : ".luau";
		return `${RojoFile.INIT_NAME}${suffix ? `.${suffix}` : ""}${extension}`;
	}

	get instanceName(): string {
		if (this.nameCutByRule) return this.stem;
		if (this.kind === "script") return RojoFile.scriptNameOf(this.stem);
		if (this.kind !== "data") return this.stem;
		return this.isJson && this.stem.endsWith(".model")
			? this.stem.slice(0, -".model".length)
			: this.stem;
	}

	/** Rojo only reads `.model` and `.project` as a suffix on `.json` files. */
	get dataName(): string {
		return this.isJson && !this.ownRule
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

const META_STRUCTURE: JsonStructure = {
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

const VALUE_TABLES = ["properties", "attributes"];

type JsoncObject = Extract<JsoncNode, { kind: "object" }>;

const lastNamed = (node: JsoncObject, name: string): JsoncNode =>
	[...node.properties].reverse().find((property) => property.name === name)!
		.value;

export interface ParsedMeta {
	readonly fields: RojoMetaFields;
	readonly typos: readonly Diagnostic[];
}

export class RojoMeta {
	private static readonly documents = new JsoncDocumentReader({
		codePrefix: "meta",
		noun: "a meta file",
	});

	static parse(text: string, file: string): Result<ParsedMeta, Diagnostic[]> {
		if (text.startsWith(BYTE_ORDER_MARK))
			return err([
				errorDiagnostic(
					"meta.byteOrderMark",
					{ resource: file, position: { line: 1, column: 1 } },
					"starts with a byte order mark, which Rojo can't read. Save the file as UTF-8 without one."
				),
			]);
		const document = RojoMeta.documents.read(text, file, META_STRUCTURE);
		if (document.isErr()) return err(document.error);

		const { root, value } = document.value;
		const unreadable = RojoMeta.unreadableValues(root, value, file);
		if (unreadable.length > 0) return err(unreadable);
		const known = Object.keys(META_STRUCTURE.properties!);
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

	private static unreadableValues(
		root: JsoncObject,
		value: Readonly<Record<string, unknown>>,
		file: string
	): Diagnostic[] {
		return VALUE_TABLES.flatMap((table) => {
			const values = getOwn(value, table);
			if (!isObject(values)) return [];
			const node = lastNamed(root, table) as JsoncObject;
			return Object.entries(values)
				.filter(([, found]) => !PropertyValues.isReadable(found))
				.map(([name]) => {
					const at = lastNamed(node, name);
					return errorDiagnostic(
						"meta.unreadableValue",
						{
							resource: file,
							position: { line: at.line, column: at.column },
						},
						`"${table}.${name}": Rojo can't read this value. ${PropertyValues.READABLE_HINT}`
					);
				});
		});
	}

	/**
	 * Applies `over` after `base`, as Rojo applies a `.meta.jsonc` after a
	 * `.meta.json`; properties merge.
	 */
	static merged(base: RojoMetaFields, over: RojoMetaFields): RojoMetaFields {
		return {
			...base,
			...over,
			...((base.properties || over.properties) && {
				properties: { ...base.properties, ...over.properties },
			}),
		};
	}

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
