import path from "path";
import { stemOf } from "../../base/path.js";

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
const INIT_SCRIPT = /^(init|index)([.@-][a-z0-9_]+)?\./i;

/** A file name as Rojo reads it: what it turns the file into, and which names it takes from it. */
export class RojoFile {
	static readonly SCRIPT_EXTENSIONS: readonly string[] = [
		".luau",
		".lua",
		".ts",
		".tsx",
	];
	static readonly META_SUFFIX = ".meta.json";
	static readonly INIT_META = `init${RojoFile.META_SUFFIX}`;

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

	get isInitScript(): boolean {
		return this.kind === "script" && INIT_SCRIPT.test(this.name);
	}

	get scriptSuffix(): RojoScriptSuffix | undefined {
		return RojoFile.scriptSuffixOf(this.stem);
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

	/** A dot, or a dash when Rojo reads `.key` for this kind of file, so the suffix stays in the name. */
	suffixSeparator(key: string): "." | "-" {
		return this.readsAsSuffix(key) ? "-" : ".";
	}

	private readsAsSuffix(key: string): boolean {
		const probe = `x.${key.toLowerCase()}`;
		if (this.kind === "script") {
			return RojoFile.scriptSuffixOf(probe) !== undefined;
		}
		return this.kind === "data" && RojoFile.dataNameOf(probe) !== probe;
	}
}
