import path from "path";
import { joinPosix, stemOf } from "../../base/path.js";
import { capitalized } from "../../base/strings.js";
import { DeclaredKeys } from "../config/config.js";
import { RojoFile, RojoFileKind } from "../rojo/rojo-file.js";
import { ScannedEntry, ScannedRoot } from "./root-scanner.js";

/** Whether a folder routes, carries a tag or is ordinary. */
export type FolderReading =
	| {
			readonly kind: "route" | "tag";
			readonly key: string;
			readonly invisible: boolean;
	  }
	| {
			readonly kind: "plain";
			readonly name: string;
			readonly invisible: boolean;
	  };

export type SuffixForm = "separator" | "capital";

export interface SuffixSpan {
	readonly key: string;
	/** Where the key and its separator begin in the stem. */
	readonly start: number;
	readonly length: number;
	readonly form: SuffixForm;
}

export interface SuffixMatch {
	readonly baseName: string;
	readonly matchedKeys: ReadonlySet<string>;
	/** In match order: the trailing key first. */
	readonly spans: readonly SuffixSpan[];
	/** A declared key that the base name still ends with after a separator, in different letter case. */
	readonly nearMissKey?: string;
}

interface SuffixCandidate {
	readonly strippedLength: number;
	readonly form: SuffixForm;
}

/** Finds the config's declared keys in folder names, marker files and file suffixes. */
export class NameReader {
	private static readonly SEPARATOR_CHARS = "+._@-";
	private static readonly INVISIBLE_FOLDER = /^\((.+)\)$/;

	constructor(private readonly keys: DeclaredKeys) {}

	/** The file name with the span's suffix rewritten as `<separator><key>`. */
	static withSeparatorSuffix(
		fileName: string,
		span: SuffixSpan,
		separator: string
	): string {
		return (
			fileName.slice(0, span.start) +
			separator +
			span.key +
			fileName.slice(span.start + span.length)
		);
	}

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

	/** Whether a folder routes, carries a tag or is ordinary; parentheses come off first. */
	folder(folderName: string): FolderReading {
		const { name, invisible } =
			NameReader.unwrapInvisibleFolder(folderName);
		const route = this.keys.resolveRoute(name);
		if (route) return { kind: "route", key: route, invisible };
		const tag = this.keys.resolveTag(name);
		if (tag) return { kind: "tag", key: tag, invisible };
		return { kind: "plain", name, invisible };
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

	// Only a trailing run counts: in `Foo.mock.Bar`, `Bar` stops it before `mock`.
	suffixes(stem: string): SuffixMatch {
		let remaining = stem;
		const matched = new Set<string>();
		const spans: SuffixSpan[] = [];

		while (remaining.length > 0) {
			let bestKey: string | undefined;
			let best: SuffixCandidate | undefined;

			for (const key of this.keys.all) {
				const found = this.findSuffix(remaining, key);
				if (
					found &&
					found.strippedLength > (best?.strippedLength ?? 0)
				) {
					best = found;
					bestKey = key;
				}
			}

			if (!bestKey || !best) break;

			matched.add(bestKey);
			remaining = remaining.slice(
				0,
				remaining.length - best.strippedLength
			);
			spans.push({
				key: bestKey,
				start: remaining.length,
				length: best.strippedLength,
				form: best.form,
			});
		}

		return {
			baseName: remaining,
			matchedKeys: matched,
			spans,
			nearMissKey: this.findSeparatorNearMiss(remaining),
		};
	}

	private findSuffix(
		remaining: string,
		key: string
	): SuffixCandidate | undefined {
		const separator = this.findSeparator(remaining, key);
		const capital = this.findCapital(remaining, key);
		if (!separator || !capital) return separator ?? capital;
		return capital.strippedLength > separator.strippedLength
			? capital
			: separator;
	}

	private findSeparator(
		remaining: string,
		key: string
	): SuffixCandidate | undefined {
		for (const sep of NameReader.SEPARATOR_CHARS) {
			for (const spelling of [key, DeclaredKeys.flipFirstLetter(key)]) {
				if (remaining.endsWith(sep + spelling)) {
					return {
						strippedLength: sep.length + spelling.length,
						form: "separator",
					};
				}
			}
		}
		return undefined;
	}

	private findCapital(
		remaining: string,
		key: string
	): SuffixCandidate | undefined {
		const word = capitalized(key);
		if (!remaining.endsWith(word)) return undefined;

		// A bare `Server` has no base name, so it isn't a suffix.
		const before = remaining[remaining.length - word.length - 1];
		if (before === undefined || !/[a-z0-9]/.test(before)) return undefined;

		return { strippedLength: word.length, form: "capital" };
	}

	private findSeparatorNearMiss(remaining: string): string | undefined {
		const lower = remaining.toLowerCase();
		for (const key of this.keys.all)
			for (const sep of NameReader.SEPARATOR_CHARS)
				if (lower.endsWith(sep + key.toLowerCase())) return key;
		return undefined;
	}
}

/** A folder read once: what its name means, and the declared key it only differs from in case. */
export type FolderRead = FolderReading & {
	readonly segment: string;
	/** The folder relative to the root dir. */
	readonly dir: string;
	readonly nearMissKey?: string;
};

export interface MarkerRead {
	/** The declared route or tag key the marker spells. */
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

	constructor(
		private readonly reader: NameReader,
		private readonly keys: DeclaredKeys,
		roots: readonly ScannedRoot[]
	) {
		for (const root of roots) {
			for (const marker of root.markers) {
				this.readFoldersAbove(root.rootDir, marker);
				this.markers.set(
					joinPosix(root.rootDir, marker),
					this.reader.marker(path.posix.basename(marker))
				);
			}
			for (const metaFile of root.metaFiles)
				this.readFoldersAbove(root.rootDir, metaFile);
			for (const entry of root.entries) {
				const { fileName, kind, stem } =
					NameReadings.suffixedNameOf(entry);
				this.entries.set(entry.source, {
					folders: this.readFoldersAbove(
						root.rootDir,
						entry.relativePath
					),
					fileName,
					kind,
					stem,
					match: this.reader.suffixes(stem),
				});
			}
		}
	}

	/** The entry's reading. Every scanned entry has one, so a miss is a programmer error. */
	entryAt(source: string): EntryRead {
		const read = this.entries.get(source);
		if (!read) throw new Error(`${source} was not scanned.`);
		return read;
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
		const isInitFolder = entry.kind === "init-folder";
		const fileName = isInitFolder
			? entry.initFile
			: path.posix.basename(entry.relativePath);
		const kind: RojoFileKind = isInitFolder ? "script" : entry.kind;
		const stem = stemOf(fileName);
		return {
			fileName,
			kind,
			stem: kind === "data" ? RojoFile.dataNameOf(stem) : stem,
		};
	}
}
