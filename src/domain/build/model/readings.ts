import { RojoFileKind } from "../../rojo/rojo-files.js";
import { FolderReading, SuffixMatch } from "../keys/declared-key.js";

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
export interface PathReadings {
	/** By absolute POSIX path; holds every folder above an entry, marker or meta file. */
	readonly folders: ReadonlyMap<string, FolderRead>;
	/** By absolute POSIX path. */
	readonly markers: ReadonlyMap<string, MarkerRead>;
	/** By the entry's source. */
	readonly entries: ReadonlyMap<string, EntryRead>;
}
