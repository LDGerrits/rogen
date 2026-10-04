import path from "path";
import { joinPosix, stemOf } from "../../base/path.js";
import { closestMatch, editDistance } from "../../base/strings.js";
import { DeclaredKeys } from "../config/config.js";
import { RojoFile, RojoFileKind } from "../rojo/rojo-file.js";
import { ScannedEntry, ScannedRoot, namingFileOf } from "./root-scanner.js";

/** Whether a folder routes, carries a variant or is ordinary. */
export type FolderReading =
	| {
			readonly kind: "route" | "variant";
			readonly key: string;
			readonly invisible: boolean;
			/** What a route folder written `Name@key` keeps as its name; a plain or bare `@key` folder keeps none. */
			readonly keptName?: string;
	  }
	| {
			readonly kind: "plain";
			readonly name: string;
			readonly invisible: boolean;
	  };

export interface SuffixSpan {
	readonly key: string;
	/** Where the key and its sign begin in the stem. */
	readonly start: number;
	readonly length: number;
}

/** An `@` that no declared route follows. */
export interface StrayAt {
	/** The name after the `@`, up to the next dot. */
	readonly text: string;
	/** The declared route key closest to `text`. */
	readonly closestKey?: string;
	/** `text` is a declared route, but dot parts follow it, so it isn't at the end of the name. */
	readonly notLast: boolean;
}

/** A trailing dot part that is one edit from a declared variant. */
export interface VariantTypo {
	readonly text: string;
	readonly variant: string;
}

export interface SuffixMatch {
	readonly baseName: string;
	readonly matchedKeys: ReadonlySet<string>;
	/** In match order: the trailing key first. */
	readonly spans: readonly SuffixSpan[];
	/** An `@` left in the base name that doesn't route. */
	readonly strayAt?: StrayAt;
	/** An undeclared dot part left at the end of the base name that looks like a mistyped variant. */
	readonly variantTypo?: VariantTypo;
}

/** The script suffixes Rojo reads from a dot, which route when a key of that name is declared. */
const DOT_ROUTE_KEYS: ReadonlySet<string> = new Set(["server", "client"]);

/** Finds the config's declared keys in folder names, marker files and file suffixes. */
export class NameReader {
	private static readonly INVISIBLE_FOLDER = /^\((.+)\)$/;

	constructor(private readonly keys: DeclaredKeys) {}

	/** A folder written `(name)` is the folder `name`, left out of the tree. */
	static unwrapInvisibleFolder(folderName: string): {
		readonly name: string;
		readonly invisible: boolean;
	} {
		const inner = NameReader.INVISIBLE_FOLDER.exec(folderName)?.[1];
		return inner === undefined
			? { name: folderName, invisible: false }
			: { name: inner, invisible: true };
	}

	/** Whether a folder routes, carries a variant or is ordinary; parentheses come off first. */
	folder(folderName: string): FolderReading {
		const { name, invisible } =
			NameReader.unwrapInvisibleFolder(folderName);
		const route = this.keys.resolveRoute(name);
		if (route) return { kind: "route", key: route, invisible };
		const variant = this.keys.resolveVariant(name);
		if (variant) return { kind: "variant", key: variant, invisible };
		const at = name.lastIndexOf("@");
		const atKey =
			at >= 0 ? this.keys.resolveRoute(name.slice(at + 1)) : undefined;
		if (atKey) {
			const keptName = name.slice(0, at);
			return {
				kind: "route",
				key: atKey,
				invisible,
				...(keptName !== "" && { keptName }),
			};
		}
		return { kind: "plain", name, invisible };
	}

	/** The `@` in a folder name that no declared route follows. */
	folderStrayAt(folderName: string): StrayAt | undefined {
		const { name } = NameReader.unwrapInvisibleFolder(folderName);
		return this.strayAt(name);
	}

	/** The declared key a marker file spells, `.server` for `server`. */
	marker(fileName: string): MarkerRead {
		return {
			key:
				fileName.startsWith(".") && fileName.length >= 2
					? this.keys.resolve(fileName.slice(1))
					: undefined,
			nearMissKey: this.keys.nearMiss(fileName.slice(1)),
		};
	}

	/** Only a trailing run counts: in `Foo.mock.Bar`, `Bar` stops it before `mock`. */
	suffixes(stem: string): SuffixMatch {
		let remaining = stem;
		const matched = new Set<string>();
		const spans: SuffixSpan[] = [];

		for (
			let span = this.trailingSpan(remaining);
			span;
			span = this.trailingSpan(remaining)
		) {
			matched.add(span.key);
			remaining = remaining.slice(0, span.start);
			spans.push(span);
		}

		return {
			baseName: remaining,
			matchedKeys: matched,
			spans,
			strayAt: this.strayAt(remaining),
			variantTypo: this.variantTypo(remaining),
		};
	}

	/** `@route` at the end, or a trailing dot part that is a variant or Rojo's `.server`/`.client` of a declared route. */
	private trailingSpan(remaining: string): SuffixSpan | undefined {
		const dot = remaining.lastIndexOf(".");
		const at = remaining.lastIndexOf("@");
		if (dot > at) {
			const part = remaining.slice(dot + 1);
			const key =
				this.keys.resolveVariant(part) ??
				(DOT_ROUTE_KEYS.has(part)
					? this.keys.resolveRoute(part)
					: undefined);
			return key && dot > 0
				? { key, start: dot, length: remaining.length - dot }
				: undefined;
		}
		const key = this.keys.resolveRoute(remaining.slice(at + 1));
		return at > 0 && key
			? { key, start: at, length: remaining.length - at }
			: undefined;
	}

	/** `.spec` and `.story` are ordinary names, so only a part one edit from a declared variant is reported. */
	private variantTypo(remaining: string): VariantTypo | undefined {
		const dot = remaining.lastIndexOf(".");
		if (dot <= 0 || dot < remaining.lastIndexOf("@")) return undefined;
		const text = remaining.slice(dot + 1);
		if (DOT_ROUTE_KEYS.has(text)) return undefined;
		const variant = [...this.keys.variantKeys].find(
			(key) => editDistance(text.toLowerCase(), key.toLowerCase()) <= 1
		);
		return variant ? { text, variant } : undefined;
	}

	private strayAt(name: string): StrayAt | undefined {
		const at = name.lastIndexOf("@");
		if (at <= 0) return undefined;
		const text = name.slice(at + 1).split(".")[0];
		if (text === "") return undefined;
		return {
			text,
			closestKey: closestMatch(text, this.keys.routeKeys),
			notLast: this.keys.resolveRoute(text) !== undefined,
		};
	}
}

/** A folder read once: what its name means, and the declared key it only differs from in case. */
export type FolderRead = FolderReading & {
	readonly segment: string;
	/** The folder relative to the root dir. */
	readonly dir: string;
	readonly nearMissKey?: string;
	readonly strayAt?: StrayAt;
};

export interface MarkerRead {
	/** The declared route or variant key the marker spells. */
	readonly key: string | undefined;
	readonly nearMissKey: string | undefined;
}

/** An entry read once: its folders and the suffixes on the file that carries its name. */
export interface EntryRead {
	/** The folders above the entry, outermost first. */
	readonly folders: readonly FolderRead[];
	/** The file whose stem carries the suffixes: an init folder's script, or the file itself. */
	readonly fileName: string;
	readonly kind: RojoFileKind;
	readonly stem: string;
	readonly match: SuffixMatch;
}

/** Every folder, marker and suffix the declared keys can claim, read once and shared by the stages and rules. */
export class NameReadings {
	/** By absolute POSIX path; holds every folder above an entry, marker or meta file. */
	readonly folders = new Map<string, FolderRead>();
	/** By absolute POSIX path. */
	readonly markers = new Map<string, MarkerRead>();
	/** By the entry's source. */
	readonly entries = new Map<string, EntryRead>();
	/** Each marker or folder above an entry whose name only differs from a declared key in letter case, with that key; first found first. */
	readonly nearMisses = new Map<string, string>();
	/** Each folder above an entry, or entry, with an `@` that doesn't route; first found first. */
	readonly strayAts = new Map<string, StrayAt>();
	/** Each entry whose name ends in a dot part one edit from a declared variant; first found first. */
	readonly variantTypos = new Map<string, VariantTypo>();

	constructor(
		private readonly reader: NameReader,
		private readonly keys: DeclaredKeys,
		roots: readonly ScannedRoot[]
	) {
		for (const root of roots) {
			for (const marker of root.markers) {
				this.readFoldersAbove(root.rootDir, marker);
				const resource = joinPosix(root.rootDir, marker);
				const read = this.reader.marker(path.posix.basename(marker));
				this.markers.set(resource, read);
				this.noteNearMiss(resource, read.nearMissKey);
			}
			for (const metaFile of root.metaFiles)
				this.readFoldersAbove(root.rootDir, metaFile);
			for (const entry of root.entries) {
				const { fileName, kind, stem } =
					NameReadings.suffixedNameOf(entry);
				const folders = this.readFoldersAbove(
					root.rootDir,
					entry.relativePath
				);
				const match = this.reader.suffixes(stem);
				this.entries.set(entry.source, {
					folders,
					fileName,
					kind,
					stem,
					match,
				});
				for (const folder of folders) {
					const resource = joinPosix(root.rootDir, folder.dir);
					this.noteNearMiss(resource, folder.nearMissKey);
					this.noteStrayAt(resource, folder.strayAt);
				}
				this.noteStrayAt(entry.source, match.strayAt);
				if (match.variantTypo && !this.variantTypos.has(entry.source))
					this.variantTypos.set(entry.source, match.variantTypo);
			}
		}
	}

	/** The entry's reading. Every scanned entry has one, so a miss is a programmer error. */
	entryAt(source: string): EntryRead {
		const read = this.entries.get(source);
		if (!read) throw new Error(`${source} was not scanned.`);
		return read;
	}

	private noteNearMiss(resource: string, key: string | undefined): void {
		if (key && !this.nearMisses.has(resource))
			this.nearMisses.set(resource, key);
	}

	private noteStrayAt(resource: string, strayAt: StrayAt | undefined): void {
		if (strayAt && !this.strayAts.has(resource))
			this.strayAts.set(resource, strayAt);
	}

	private folderAt(rootDir: string, dir: string): FolderRead {
		const key = joinPosix(rootDir, dir);
		let read = this.folders.get(key);
		if (!read) {
			const segment = path.posix.basename(dir);
			const reading = this.reader.folder(segment);
			read = {
				...reading,
				segment,
				dir,
				nearMissKey:
					reading.kind === "plain"
						? this.keys.nearMiss(reading.name)
						: undefined,
				strayAt:
					reading.kind === "plain"
						? this.reader.folderStrayAt(segment)
						: undefined,
			};
			this.folders.set(key, read);
		}
		return read;
	}

	private readFoldersAbove(
		rootDir: string,
		relativePath: string
	): FolderRead[] {
		const above: FolderRead[] = [];
		let dir = "";
		for (const segment of relativePath.split("/").slice(0, -1)) {
			dir = dir ? `${dir}/${segment}` : segment;
			above.push(this.folderAt(rootDir, dir));
		}
		return above;
	}

	private static suffixedNameOf(entry: ScannedEntry): {
		readonly fileName: string;
		readonly kind: RojoFileKind;
		readonly stem: string;
	} {
		const { fileName, kind } = namingFileOf(entry);
		const stem = stemOf(fileName);
		return {
			fileName,
			kind,
			stem: kind === "data" ? RojoFile.dataNameOf(stem) : stem,
		};
	}
}
