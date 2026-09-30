import path from "path";
import { joinPosix, stemOf } from "../../base/path.js";
import { capitalized } from "../../base/string.js";
import { DeclaredKeys } from "../config/config.js";
import { Target } from "../roblox/roblox.js";
import { RojoFile, RojoFileKind, RojoScriptSuffix } from "../rojo/rojo-file.js";
import { MatchForm, RouteMatch, TagMatch } from "./build-service.js";
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

/** A node one of the file's own folders becomes, with that folder relative to the root dir. */
export interface FolderNode {
	readonly instancePath: readonly string[];
	readonly dir: string;
}

export interface RoutedFile {
	readonly entry: ScannedEntry;
	/** The governing route key, or `*`. */
	readonly route: string;
	readonly routeMatch: RouteMatch;
	/** The file name with a capital route suffix written as a separator suffix that Rojo leaves in the name. */
	readonly separatorName?: string;
	/** The service, the target's folders, the file's own folders, then the instance name. */
	readonly instancePath: readonly string[];
	/** Routing, tag and invisible folders name no node, so they have none. */
	readonly folderNodes: readonly FolderNode[];
	/** Tag folders and suffixes are already out of `instancePath`; the tag stage decides what they mean. */
	readonly tags: readonly TagMatch[];
	/** A `.server`/`.client` that a tag suffix follows, which Rojo won't read as a script class. */
	readonly buriedScriptSuffix?: RojoScriptSuffix;
}

/** What the folders and markers above a file, then its own suffixes, claim for it. */
interface Claims {
	route: { readonly key: string; readonly match: MatchForm } | undefined;
	readonly tags: TagMatch[];
}

interface LeafReading {
	readonly name: string;
	readonly separatorName: string | undefined;
	readonly buriedScriptSuffix: RojoScriptSuffix | undefined;
}

/** Finds each scanned file's governing route and instance path. */
export class Router {
	constructor(
		private readonly keys: DeclaredKeys,
		private readonly targets: ReadonlyMap<string, Target>,
		private readonly readings: NameReadings
	) {}

	/** Every file a route governs, in scan order, and the sources of the files no route governs. */
	route(roots: readonly ScannedRoot[]): {
		routed: RoutedFile[];
		unrouted: string[];
	} {
		const routed: RoutedFile[] = [];
		const unrouted: string[] = [];
		for (const root of roots) {
			const markers = root.markersByDir();
			for (const entry of root.entries) {
				const outcome = this.routeEntry(entry, markers);
				if (outcome) routed.push({ entry, ...outcome });
				else unrouted.push(entry.source);
			}
		}
		return { routed, unrouted };
	}

	private routeEntry(
		entry: ScannedEntry,
		markers: ReadonlyMap<string, string[]>
	): Omit<RoutedFile, "entry"> | undefined {
		const read = this.readings.entryAt(entry.source);
		const claims: Claims = { route: undefined, tags: [] };
		const folders = this.readFolders(entry, read, markers, claims);
		const { name, separatorName, buriedScriptSuffix } = this.readLeaf(
			entry,
			read,
			claims
		);

		const route = claims.route?.key ?? DeclaredKeys.FALLBACK_ROUTE;
		const target = this.targets.get(route);
		if (!target) return undefined;

		const folderNodes: FolderNode[] = [];
		let parent: readonly string[] = target.instancePath;
		for (const folder of folders) {
			parent = [...parent, folder.segment];
			folderNodes.push({ instancePath: parent, dir: folder.dir });
		}
		return {
			route,
			routeMatch: claims.route?.match ?? "fallback",
			separatorName,
			instancePath: [...parent, name],
			folderNodes,
			tags: claims.tags,
			buriedScriptSuffix,
		};
	}

	/** Routing, tag and invisible folders and markers claim the file; every other folder becomes a node. */
	private readFolders(
		entry: ScannedEntry,
		read: EntryRead,
		markers: ReadonlyMap<string, string[]>,
		claims: Claims
	): FolderRead[] {
		const applyMarkers = (dir: string) => {
			for (const fileName of markers.get(dir) ?? []) {
				const key = this.readings.markers.get(
					joinPosix(entry.rootDir, dir, fileName)
				)?.key;
				if (key === undefined) continue;
				if (this.keys.isTag(key))
					claims.tags.push({ tag: key, form: "marker" });
				else claims.route ??= { key, match: "marker" };
			}
		};

		applyMarkers("");
		const folders: FolderRead[] = [];
		for (const folder of read.folders) {
			if (folder.kind === "route")
				claims.route ??= { key: folder.key, match: "folder" };
			else if (folder.kind === "tag")
				claims.tags.push({ tag: folder.key, form: "folder" });
			else if (!folder.invisible) folders.push(folder);
			applyMarkers(folder.dir);
		}
		return folders;
	}

	/** Reads the suffixes of a file, or of an init folder's script, into `claims` and returns the instance name. */
	private readLeaf(
		entry: ScannedEntry,
		{ fileName, kind, stem, match }: EntryRead,
		claims: Claims
	): LeafReading {
		const tagSpans = match.spans.filter((span) =>
			this.keys.isTag(span.key)
		);
		claims.tags.push(
			...tagSpans.map((span) => this.asTagMatch(span, fileName))
		);
		const routeSpan = claims.route
			? undefined
			: match.spans.find((span) => this.keys.routeKeys.has(span.key));
		if (routeSpan)
			claims.route = { key: routeSpan.key, match: routeSpan.form };
		const separatorName =
			routeSpan && this.separatorNameOf(fileName, routeSpan);

		if (entry.kind === "init-folder") {
			return {
				name: path.posix.basename(entry.relativePath),
				separatorName,
				buriedScriptSuffix: undefined,
			};
		}

		const buriedScriptSuffix =
			kind === "script" &&
			tagSpans.length > 0 &&
			!RojoFile.scriptSuffixOf(stem)
				? RojoFile.scriptSuffixOf(this.stripSpans(stem, tagSpans))
				: undefined;
		const stripped = this.stripSpans(
			stem,
			routeSpan ? [...tagSpans, routeSpan] : tagSpans
		);
		return {
			name:
				kind === "script" ? RojoFile.scriptNameOf(stripped) : stripped,
			separatorName,
			buriedScriptSuffix,
		};
	}

	private asTagMatch(span: SuffixSpan, fileName: string): TagMatch {
		const match = { tag: span.key, form: span.form };
		const separatorName = this.separatorNameOf(fileName, span);
		return separatorName ? { ...match, separatorName } : match;
	}

	private separatorNameOf(
		fileName: string,
		span: SuffixSpan
	): string | undefined {
		return span.form === "capital"
			? NameReader.withSeparatorSuffix(
					fileName,
					span,
					new RojoFile(fileName).suffixSeparator(span.key)
				)
			: undefined;
	}

	/** Keeps the stem whole rather than return an empty name. */
	private stripSpans(stem: string, spans: readonly SuffixSpan[]): string {
		const stripped = [...spans]
			.sort((a, b) => b.start - a.start)
			.reduce(
				(name, span) =>
					name.slice(0, span.start) +
					name.slice(span.start + span.length),
				stem
			);
		return stripped || stem;
	}
}
