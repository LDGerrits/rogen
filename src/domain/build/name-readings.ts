import path from "path";
import { joinPosix, stemOf } from "../../base/path.js";
import { DeclaredKeys } from "../config/config.js";
import { RojoFile, RojoFileKind, RojoScriptSuffix } from "../rojo/rojo.js";
import {
	Misspelling,
	MisspellingKind,
	MisspellingOf,
	NotedName,
	Respelling,
} from "./misspelling-finder.js";
import {
	FolderNameReading,
	MarkerReading,
	NameReader,
	SuffixMatch,
} from "./name-reader.js";
import { InstanceName } from "./instance-name.js";
import { ScannedFile, ScannedRoot } from "./root-scanner.js";

/** A folder that never becomes an instance, as a warning names it. */
export type InstancelessFolder =
	"a root dir" | "a routing folder" | "an invisible folder";

/** A folder read once: what its name means, and the declared key it only differs from in case. */
export type FolderReading = FolderNameReading & {
	readonly segment: string;
	/** The folder relative to the root dir. */
	readonly dir: string;
	readonly nearMissKey?: string;
};

/** An entry read once: its folders and the suffixes on its name. */
export interface EntryReading {
	/** The folders above the entry, outermost first. */
	readonly folders: readonly FolderReading[];
	readonly fileName: string;
	readonly kind: RojoFileKind;
	readonly stem: string;
	/** The script class Rojo reads from the stem: a `.server`, `.client` or `.plugin` script; none for any other file. */
	readonly scriptSuffix: RojoScriptSuffix | undefined;
	readonly match: SuffixMatch;
	/** Whether it is an init script once its route keys are off its name, a route it doesn't govern too. */
	readonly isInit: boolean;
}

/** Every folder, marker and suffix the route keys can claim, read once and shared by the stages and rules. */
export class NameReadings {
	private readonly _folders = new Map<string, FolderReading>();
	private readonly _markers = new Map<string, MarkerReading>();
	private readonly _entries = new Map<string, EntryReading>();
	private readonly _nearMisses = new Map<string, string>();
	/** Each marker, folder above an entry, or entry whose name misspells a key; first found first. */
	private readonly misspellings = new Map<
		string,
		readonly NotedName<Misspelling>[]
	>();

	private readonly reader: NameReader;

	constructor(
		private readonly keys: DeclaredKeys,
		/** The script names that make a file its folder. */
		private readonly initNames: ReadonlySet<string>,
		roots: readonly ScannedRoot[]
	) {
		this.reader = new NameReader(keys);
		for (const root of roots) {
			this.readMarkers(root);
			for (const metaFile of root.metaFiles)
				this.readFoldersAbove(root.rootDir, metaFile);
			for (const entry of root.entries) this.readEntry(root, entry);
		}
	}

	/** By absolute POSIX path; holds every folder above an entry, marker or meta file. */
	get folders(): ReadonlyMap<string, FolderReading> {
		return this._folders;
	}

	/** By the entry's source. */
	get entries(): ReadonlyMap<string, EntryReading> {
		return this._entries;
	}

	/** By absolute POSIX path. */
	get markers(): ReadonlyMap<string, MarkerReading> {
		return this._markers;
	}

	/** Each marker or folder above an entry whose name only differs from a declared key in letter case, with that key; first found first. */
	get nearMisses(): ReadonlyMap<string, string> {
		return this._nearMisses;
	}

	private readMarkers(root: ScannedRoot): void {
		for (const marker of root.markers) {
			this.readFoldersAbove(root.rootDir, marker);
			const resource = joinPosix(root.rootDir, marker);
			const read = this.reader.marker(path.posix.basename(marker));
			this._markers.set(resource, read);
			this.noteNearMiss(resource, read.nearMissKey);
			this.noteMisspellings(resource, read.misspellings);
		}
	}

	private readEntry(root: ScannedRoot, entry: ScannedFile): void {
		const { fileName, kind, stem } = NameReadings.suffixedNameOf(entry);
		const folders = this.readFoldersAbove(root.rootDir, entry.relativePath);
		const match = this.reader.suffixes(stem, kind === "script");
		const scriptSuffix =
			kind === "script" ? RojoFile.scriptSuffixOf(stem) : undefined;
		this._entries.set(entry.source, {
			folders,
			fileName,
			kind,
			stem,
			scriptSuffix,
			match,
			isInit:
				kind === "script" &&
				this.initNames.has(
					InstanceName.leafName(
						kind,
						InstanceName.withoutSpans(stem, match.spans)
					).name
				),
		});
		for (const folder of folders) {
			const resource = joinPosix(root.rootDir, folder.dir);
			this.noteNearMiss(resource, folder.nearMissKey);
			this.noteMisspellings(resource, folder.misspellings);
		}
		this.noteMisspellings(entry.source, match.misspellings);
	}

	/** The entry's reading. Every scanned entry has one, so a miss is a programmer error. */
	entryReading(source: string): EntryReading {
		const read = this._entries.get(source);
		if (!read) throw new Error(`${source} was not scanned.`);
		return read;
	}

	/** Why the folder `dir` of a root dir can never become an instance by its name; `undefined` for one that can, if a route places something through it. */
	instanceless(rootDir: string, dir: string): InstancelessFolder | undefined {
		if (dir === "") return "a root dir";
		const folder = this._folders.get(joinPosix(rootDir, dir));
		if (folder?.keptName !== undefined)
			return folder.invisible ? "an invisible folder" : undefined;
		return folder?.route !== undefined ? "a routing folder" : undefined;
	}

	/** Each resource whose name has a misspelling of `kind`, with it; first found first. */
	misspelt<K extends MisspellingKind>(
		kind: K
	): ReadonlyMap<string, NotedName<MisspellingOf<K>>> {
		const misspelt = new Map<string, NotedName<MisspellingOf<K>>>();
		for (const [resource, noted] of this.misspellings)
			for (const misspelling of noted)
				if (NameReadings.isKind(misspelling, kind))
					misspelt.set(resource, misspelling);
		return misspelt;
	}

	private static isKind<K extends MisspellingKind>(
		misspelling: NotedName<Misspelling>,
		kind: K
	): misspelling is NotedName<MisspellingOf<K>> {
		return misspelling.kind === kind;
	}

	private noteNearMiss(resource: string, key: string | undefined): void {
		if (key && !this._nearMisses.has(resource))
			this._nearMisses.set(resource, key);
	}

	/** Notes what the name at `resource` misspells, with the path one rename fixes it to; a resource is read once, so the first noting holds. */
	private noteMisspellings(
		resource: string,
		misspellings: readonly Misspelling[]
	): void {
		if (misspellings.length === 0 || this.misspellings.has(resource))
			return;
		this.misspellings.set(
			resource,
			misspellings.map((misspelt) => ({
				...misspelt,
				...(misspelt.respelling && {
					renamedTo: NameReadings.respelled(
						resource,
						misspelt.respelling
					),
				}),
			}))
		);
	}

	private static respelled(
		resource: string,
		{ start, written, spelling }: Respelling
	): string {
		const name = path.posix.basename(resource);
		return joinPosix(
			path.posix.dirname(resource),
			name.slice(0, start) + spelling + name.slice(start + written.length)
		);
	}

	private folderAt(rootDir: string, dir: string): FolderReading {
		const key = joinPosix(rootDir, dir);
		let read = this._folders.get(key);
		if (!read) {
			const segment = path.posix.basename(dir);
			const reading = this.reader.folder(segment);
			read = {
				...reading,
				segment,
				dir,
				nearMissKey:
					reading.route === undefined &&
					reading.keptName !== undefined
						? this.keys.nearMiss(reading.keptName)
						: undefined,
			};
			this._folders.set(key, read);
		}
		return read;
	}

	private readFoldersAbove(
		rootDir: string,
		relativePath: string
	): FolderReading[] {
		const above: FolderReading[] = [];
		let dir = "";
		for (const segment of relativePath.split("/").slice(0, -1)) {
			dir = dir ? `${dir}/${segment}` : segment;
			above.push(this.folderAt(rootDir, dir));
		}
		return above;
	}

	private static suffixedNameOf(entry: ScannedFile): {
		readonly fileName: string;
		readonly kind: RojoFileKind;
		readonly stem: string;
	} {
		const { kind } = entry;
		const fileName = path.posix.basename(entry.relativePath);
		const stem = stemOf(fileName);
		return {
			fileName,
			kind,
			stem: kind === "data" ? new RojoFile(fileName).dataName : stem,
		};
	}
}
