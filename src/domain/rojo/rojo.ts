import path from "path";
import { JSONSchema } from "../../base/json-schema.js";
import { stemOf } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { JsoncDocumentReader } from "../../platform/jsonc/jsonc-document-reader.js";
import { ScriptRun } from "../roblox/roblox.js";

export type RojoFileKind = "script" | "model" | "data";

const SCRIPT_SUFFIXES = ["server", "client", "plugin"] as const;

export type RojoScriptSuffix = (typeof SCRIPT_SUFFIXES)[number];

const MODEL_EXTENSIONS: readonly string[] = [".rbxm", ".rbxmx"];
const DATA_EXTENSIONS: readonly string[] = [
	".json",
	".toml",
	".csv",
	".txt",
	".yaml",
	".yml",
];
const INIT_FILE = /^init(\.(server|client|plugin))?\.luau?$/;

/** A file name as Rojo reads it: what it turns the file into, and which names it takes from it. */
export class RojoFile {
	static readonly SCRIPT_EXTENSIONS: readonly string[] = [
		".luau",
		".lua",
		".ts",
		".tsx",
	];
	static readonly META_SUFFIX = ".meta.json";
	static readonly INIT_NAME = "init";
	static readonly INIT_META = `${RojoFile.INIT_NAME}${RojoFile.META_SUFFIX}`;

	readonly stem: string;

	constructor(readonly name: string) {
		this.stem = stemOf(name);
	}

	/** The trailing `.server`, `.client` or `.plugin` of a stem; Rojo reads the script class only right before the extension. */
	static scriptSuffixOf(stem: string): RojoScriptSuffix | undefined {
		return SCRIPT_SUFFIXES.find((suffix) => stem.endsWith(`.${suffix}`));
	}

	/** A script stem without its script class. */
	static scriptNameOf(stem: string): string {
		const suffix = RojoFile.scriptSuffixOf(stem);
		return suffix ? stem.slice(0, -(suffix.length + 1)) : stem;
	}

	/** Rojo reads `.model.json` and `.project.json` as a model and a nested project; only the part before the suffix is ours to name. */
	static dataNameOf(stem: string): string {
		return stem.replace(/(?<=.)\.(model|project)$/, "");
	}

	get isMeta(): boolean {
		return this.name.toLowerCase().endsWith(RojoFile.META_SUFFIX);
	}

	/** What Rojo turns the file into, or `undefined` when it isn't an instance on its own. */
	get kind(): RojoFileKind | undefined {
		const lower = this.name.toLowerCase();
		if (lower.endsWith(".d.ts") || this.isMeta) return undefined;

		const extension = path.extname(lower);
		if (RojoFile.SCRIPT_EXTENSIONS.includes(extension)) return "script";
		if (MODEL_EXTENSIONS.includes(extension)) return "model";
		if (DATA_EXTENSIONS.includes(extension)) return "data";
		return undefined;
	}

	/** Whether Rojo reads the file as its folder, which also means a `$path` can't point at it. */
	get isInit(): boolean {
		return INIT_FILE.test(this.name);
	}

	/** The name Rojo gives the file when it enumerates the directory itself. */
	get instanceName(): string {
		if (this.kind === "script") return RojoFile.scriptNameOf(this.stem);
		if (this.kind !== "data") return this.stem;
		return this.stem.endsWith(".model")
			? this.stem.slice(0, -".model".length)
			: this.stem;
	}

	/** Rojo only reads `.model` and `.project` as a suffix on `.json` files. */
	get dataName(): string {
		return path.extname(this.name).toLowerCase() === ".json"
			? RojoFile.dataNameOf(this.stem)
			: this.stem;
	}

	/** The name Rojo reads the file's `.meta.json` under, or none for a file that takes no meta. */
	get metaName(): string | undefined {
		if (this.kind === "script") return RojoFile.scriptNameOf(this.stem);
		if (this.kind === "data" && this.dataName === this.stem) {
			return this.stem;
		}
		return undefined;
	}

	/** The `.meta.json` Rojo reads for the file, or none for a file that takes no meta. */
	get metaFile(): string | undefined {
		const name = this.metaName;
		return name === undefined
			? undefined
			: `${name}${RojoFile.META_SUFFIX}`;
	}
}

/** What a `.meta.json` sets on the instance it applies to. */
export interface RojoMetaFields {
	readonly className?: string;
	readonly properties?: Readonly<Record<string, unknown>>;
	readonly attributes?: Readonly<Record<string, unknown>>;
	readonly ignoreUnknownInstances?: boolean;
	readonly id?: string;
}

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

/** A `.meta.json` as Rojo reads it. */
export class RojoMeta {
	private static readonly documents = new JsoncDocumentReader({
		codePrefix: "meta",
		noun: "a meta file",
	});

	/** The fields `text` sets, or why Rojo would refuse `file`. */
	static parse(
		text: string,
		file: string
	): Result<RojoMetaFields, Diagnostic[]> {
		const document = RojoMeta.documents.read(text, file, META_SCHEMA);
		if (document.isErr()) return err(document.error);

		const { value } = document.value;
		return ok(
			Object.fromEntries(
				Object.keys(META_SCHEMA.properties ?? {})
					.filter((key) => value[key] !== undefined)
					.map((key) => [key, value[key]])
			) as RojoMetaFields
		);
	}
}

const RUN_CONTEXTS: Readonly<Record<string, ScriptRun>> = {
	Legacy: "Script",
	Server: "Server",
	Client: "Client",
	Plugin: "Plugin",
};

/** How Rojo makes a script with `suffix` run: by its class with legacy scripts on, else by its run context, and a `RunContext` its meta sets wins over both for a Script. `undefined` for a file that isn't a `.server` or `.client` script. */
export function scriptRunOf(
	suffix: RojoScriptSuffix | undefined,
	legacyScripts: boolean,
	runContext: unknown
): ScriptRun | undefined {
	if (suffix !== "server" && suffix !== "client") return undefined;
	if (suffix === "client" && legacyScripts) return "LocalScript";
	const set =
		typeof runContext === "string" ? RUN_CONTEXTS[runContext] : undefined;
	if (set) return set;
	if (legacyScripts) return "Script";
	return suffix === "server" ? "Server" : "Client";
}
