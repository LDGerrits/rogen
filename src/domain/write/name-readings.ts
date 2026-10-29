import path from "path";
import { joinPosix } from "../../base/path.js";
import { DeclaredKeys } from "../config/declared-keys.js";
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
	"a source path" | "a routing folder" | "an invisible folder";

/** A folder read once: what its name means, and the declared key it only differs from in case. */
export type FolderReading = FolderNameReading & {
	readonly segment: string;
	/** The folder relative to the source path. */
	readonly dir: string;
	readonly nearMissKey?: string;
};

export interface EntryReading {
	/** The folders above the entry, outermost first. */
	readonly folders: readonly FolderReading[];
	readonly fileName: string;
	readonly kind: RojoFileKind;
	readonly stem: string;
	/** The script class Rojo reads from the file name or its sync rule; none for any other file. */
	readonly scriptSuffix: RojoScriptSuffix | undefined;
	/** Whether a sync rule of the project cut the stem, so no script suffix is left on it. */
	readonly nameCutByRule: boolean;
	readonly match: SuffixMatch;
	/** Whether it is an init script once its route keys are off its name, or a project file Rojo reads as its folder. */
	readonly isInit: boolean;
	/** The `name` of the nested project it is, which names its instance, or its folder's for a default project file. */
	readonly projectName?: string;
}

/** Every folder, marker and suffix the route keys can claim, read once. */
export class NameReadings {
	private readonly _folders = new Map<string, FolderReading>();
	private readonly _markers = new Map<string, MarkerReading>();
	private readonly _entries = new Map<string, EntryReading>();
	private readonly _nearMisses = new Map<string, string>();
	private readonly misspellings = new Map<
		string,
		readonly NotedName<Misspelling>[]
	>();

	private readonly reader: NameReader;

	constructor(
		private readonly keys: DeclaredKeys,
		private readonly initNames: ReadonlySet<string>,
		roots: readonly ScannedRoot[],
		private readonly projectNames: ReadonlyMap<string, string> = new Map()
	) {
		this.reader = new NameReader(keys);
		for (const root of roots) {
			this.readMarkers(root);
			for (const metaFile of root.metaFiles)
				this.readFoldersAbove(root.sourcePath, metaFile);
			for (const dir of root.emptyDirs)
				this.foldersDownTo(root.sourcePath, dir);
			for (const entry of root.entries) this.readEntry(root, entry);
		}
	}

	/** By absolute POSIX path; holds every folder above an entry, marker or meta file, and every empty folder. */
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

	/** Each marker or folder above an entry whose name differs from a declared key only in letter case, with that key; first found first. */
	get nearMisses(): ReadonlyMap<string, string> {
		return this._nearMisses;
	}

	private readMarkers(root: ScannedRoot): void {
		for (const marker of root.markers) {
			this.readFoldersAbove(root.sourcePath, marker);
			const resource = joinPosix(root.sourcePath, marker);
			const read = this.reader.marker(path.posix.basename(marker));
			this._markers.set(resource, read);
			this.noteNearMiss(resource, read.nearMissKey);
			this.noteMisspellings(resource, read.misspellings);
		}
	}

	private readEntry(root: ScannedRoot, entry: ScannedFile): void {
		const { fileName, kind, stem, file } = this.suffixedNameOf(entry);
		const folders = this.readFoldersAbove(
			root.sourcePath,
			entry.relativePath
		);
		const match = this.reader.suffixes(stem, kind === "script");
		const { scriptSuffix, nameCutByRule } = file;
		const { name: leaf } = InstanceName.leafName(
			kind,
			InstanceName.withoutSpans(stem, match.spans),
			nameCutByRule
		);
		const isProjectFolder =
			file.isDefaultProject && entry.relativePath.includes("/");
		const projectName = file.isProject
			? this.projectNames.get(entry.source)
			: undefined;
		this._entries.set(entry.source, {
			folders,
			fileName,
			kind,
			stem,
			scriptSuffix,
			nameCutByRule,
			match,
			isInit:
				(kind === "script" && this.initNames.has(leaf)) ||
				(file.isCsv && leaf === RojoFile.INIT_NAME) ||
				isProjectFolder,
			...(projectName !== undefined && { projectName }),
		});
		for (const folder of folders) {
			const resource = joinPosix(root.sourcePath, folder.dir);
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

	/** Why the folder `dir` of a source path never becomes an instance by its name; `undefined` for one that can. */
	instanceless(
		sourcePath: string,
		dir: string
	): InstancelessFolder | undefined {
		if (dir === "") return "a source path";
		const folder = this._folders.get(joinPosix(sourcePath, dir));
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

	private folderAt(sourcePath: string, dir: string): FolderReading {
		const key = joinPosix(sourcePath, dir);
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
		sourcePath: string,
		relativePath: string
	): FolderReading[] {
		return this.foldersDownTo(sourcePath, path.posix.dirname(relativePath));
	}

	/** The folders from the source path down to `relativeDir`, outermost first. */
	foldersDownTo(sourcePath: string, relativeDir: string): FolderReading[] {
		const folders: FolderReading[] = [];
		if (relativeDir === "." || relativeDir === "") return folders;
		let dir = "";
		for (const segment of relativeDir.split("/")) {
			dir = dir ? `${dir}/${segment}` : segment;
			folders.push(this.folderAt(sourcePath, dir));
		}
		return folders;
	}

	private suffixedNameOf(entry: ScannedFile): {
		readonly fileName: string;
		readonly kind: RojoFileKind;
		readonly stem: string;
		readonly file: RojoFile;
	} {
		const { kind } = entry;
		const fileName = path.posix.basename(entry.relativePath);
		const { file } = entry;
		return {
			fileName,
			kind,
			stem: kind === "data" ? file.dataName : file.stem,
			file,
		};
	}
}
