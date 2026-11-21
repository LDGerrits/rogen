import path from "path";
import { tryWithAsync } from "../../base/result.js";
import {
	FileReader,
	isDirectoryType,
	isFileType,
} from "../../platform/fs/file-system-service.js";
import { PlannedMove } from "../init/project-migration.js";
import { LegacyKeywords } from "./legacy-keywords.js";

const DATA_EXTENSIONS = new Set([
	".csv",
	".txt",
	".json",
	".toml",
	".yaml",
	".yml",
	".msgpack",
	".md",
]);

const META_SUFFIX = ".meta.json";

const isDeclaration = (name: string) => name.toLowerCase().endsWith(".d.ts");

const isScript = (name: string) =>
	/\.(tsx?|luau|lua)$/i.test(name) && !isDeclaration(name);

const isTypeScript = (name: string) =>
	/\.tsx?$/i.test(name) && !isDeclaration(name);

const isSource = (name: string) =>
	isScript(name) ||
	/\.(rbxm|rbxmx)$/i.test(name) ||
	(!isDeclaration(name) &&
		!name.startsWith(".") &&
		DATA_EXTENSIONS.has(path.extname(name).toLowerCase()));

const isInitFile = (name: string) =>
	isScript(name) && /^(index|init)([.-][a-z0-9_]+)?\./i.test(name);

const ROJO_SUFFIXES = new Set([".server", ".client"]);

export type LegacyMarker = "structure" | "unwrap" | "sync";

const MARKERS = new Set(["structure", "verbatim", "unwrap"]);

export interface KeptName {
	readonly file: string;
	readonly name: string;
}

export interface OutrankedFile {
	readonly file: string;
	readonly before: string;
	readonly after: string;
}

interface Flags {
	readonly structure: boolean;
	readonly verbatim: boolean;
	readonly tagged: boolean;
	readonly outer?: string;
	readonly deepest?: string;
}

const routedBy = (flags: Flags, word: string): Flags => ({
	...flags,
	outer: flags.outer ?? word,
	deepest: word,
});

export class LegacySourceTree {
	readonly used = new Set<string>();
	readonly moves: PlannedMove[] = [];
	readonly markers: { marker: LegacyMarker; folder: string }[] = [];
	readonly tagged: string[] = [];
	readonly typeScript: KeptName[] = [];
	readonly clashes: KeptName[] = [];
	readonly outranked: OutrankedFile[] = [];
	private readonly folderSpellings = new Map<string, Map<string, number>>();

	constructor(
		private readonly files: FileReader,
		private readonly root: string,
		private readonly keywords: LegacyKeywords,
		private readonly knownTags: ReadonlySet<string>,
		private readonly verbatim: boolean,
		private readonly keyOf: (keyword: string) => string,
		private readonly targetOf: (keyword: string) => string
	) {}

	folderSpelling(keyword: string): string | undefined {
		const spellings = this.folderSpellings.get(keyword);
		if (!spellings) return undefined;
		return [...spellings].reduce((most, entry) =>
			entry[1] > most[1] ? entry : most
		)[0];
	}

	private noteFolderSpelling(keyword: string, spelled: string): void {
		const spellings =
			this.folderSpellings.get(keyword) ?? new Map<string, number>();
		spellings.set(spelled, (spellings.get(spelled) ?? 0) + 1);
		this.folderSpellings.set(keyword, spellings);
	}

	async scan(sourcePaths: readonly string[]): Promise<this> {
		for (const sourcePath of sourcePaths)
			await this.walk(path.resolve(this.root, sourcePath), {
				structure: false,
				verbatim: this.verbatim,
				tagged: false,
			});
		return this;
	}

	private relative(file: string): string {
		return path.relative(this.root, file).split(path.sep).join("/");
	}

	private async walk(folder: string, inherited: Flags): Promise<void> {
		const listing = await tryWithAsync(() =>
			this.files.readDirectory(folder)
		);
		if (listing.isErr()) return;
		const entries = [...listing.value].sort(([a], [b]) =>
			a.localeCompare(b)
		);
		const names = entries
			.filter(([, type]) => isFileType(type))
			.map(([name]) => name);
		const flags = this.readMarkers(folder, names, inherited);
		if (names.includes(".sync")) {
			this.markers.push({
				marker: "sync",
				folder: this.relative(folder),
			});
			return;
		}
		if (names.some(isInitFile)) return;
		const taken = new Set(names);
		for (const name of names) {
			if (
				name.startsWith(".") ||
				!isSource(name) ||
				name.endsWith(META_SUFFIX)
			)
				continue;
			this.readName(folder, name, flags, taken);
		}
		for (const [name, type] of entries) {
			if (!isDirectoryType(type)) continue;
			const spelled = name.replace(/^\((.*)\)$/, "$1");
			const word = spelled.toLowerCase();
			const routes = !flags.structure && this.keywords.has(word);
			if (routes) {
				this.used.add(word);
				this.noteFolderSpelling(word, spelled);
			}
			await this.walk(path.join(folder, name), {
				...(routes ? routedBy(flags, word) : flags),
				tagged: flags.tagged || this.knownTags.has(word),
			});
		}
	}

	private readMarkers(
		folder: string,
		names: readonly string[],
		inherited: Flags
	): Flags {
		let { structure, verbatim, tagged } = inherited;
		let routed: Flags = inherited;
		for (const name of names) {
			if (!name.startsWith(".")) continue;
			const word = name.slice(1).toLowerCase();
			if (MARKERS.has(word)) {
				if (word === "verbatim") verbatim = true;
				else {
					if (word === "structure") structure = true;
					this.markers.push({
						marker: word as LegacyMarker,
						folder: this.relative(folder),
					});
				}
			} else if (this.knownTags.has(word)) tagged = true;
		}
		for (const name of names) {
			const word = name.slice(1);
			if (
				!name.startsWith(".") ||
				structure ||
				MARKERS.has(word.toLowerCase()) ||
				!this.keywords.has(word)
			)
				continue;
			this.used.add(word.toLowerCase());
			routed = routedBy(routed, word.toLowerCase());
			this.moves.push({
				from: this.relative(path.join(folder, name)),
				to: this.relative(
					path.join(folder, `@${this.keyOf(word.toLowerCase())}`)
				),
			});
		}
		return { ...routed, structure, verbatim, tagged };
	}

	private compare(file: string, flags: Flags, named?: string): void {
		const before = named ?? flags.deepest;
		const after = flags.outer ?? named;
		if (before === undefined || after === undefined) return;
		const [v1, v2] = [this.targetOf(before), this.targetOf(after)];
		if (v1 !== v2) this.outranked.push({ file, before: v1, after: v2 });
	}

	private readName(
		folder: string,
		name: string,
		flags: Flags,
		taken: Set<string>
	): void {
		const extension = path.extname(name);
		const stem = name.slice(0, -extension.length || undefined);
		const hoisted = stem.startsWith("^");
		const bare = hoisted ? stem.slice(1) : stem;
		const file = this.relative(path.join(folder, name));
		if (
			flags.tagged ||
			bare
				.split(/[.\-_+]/)
				.some((part) => this.knownTags.has(part.toLowerCase()))
		) {
			this.tagged.push(file);
			return;
		}
		if (flags.structure) return;
		const affix = bare.includes("@")
			? undefined
			: this.keywords.affixOf(bare);
		this.compare(file, flags, affix?.keyword);
		if (!affix) return;
		this.used.add(affix.keyword);
		if (ROJO_SUFFIXES.has(affix.written.toLowerCase()) && isScript(name))
			return;
		const renamed = `${hoisted ? "^" : ""}${flags.verbatim ? bare : affix.stripped}@${this.keyOf(affix.keyword)}`;
		const to = `${renamed}${extension}`;
		if (isTypeScript(name)) {
			this.typeScript.push({ file, name: to });
			return;
		}
		if (taken.has(to)) {
			this.clashes.push({ file, name: to });
			return;
		}
		taken.add(to);
		this.moves.push({
			from: file,
			to: this.relative(path.join(folder, to)),
		});
		const meta = `${stem}${META_SUFFIX}`;
		if (taken.has(meta))
			this.moves.push({
				from: this.relative(path.join(folder, meta)),
				to: this.relative(
					path.join(folder, `${renamed}${META_SUFFIX}`)
				),
			});
	}
}
