import { RojoFileKind } from "../../rojo/rojo-files.js";

export interface ScannedFile {
	readonly kind: RojoFileKind;
	readonly rootDir: string;
	readonly relativePath: string;
	/** The absolute POSIX source path. */
	readonly source: string;
}

export interface ScannedInitFolder {
	readonly kind: "init-folder";
	readonly rootDir: string;
	readonly relativePath: string;
	/** The absolute POSIX path of the folder. */
	readonly source: string;
	readonly initFile: string;
}

export type ScannedEntry = ScannedFile | ScannedInitFolder;

/** Why the scan left a path out; the path is the key it is stored under. */
export type ScanLeftOut =
	| { readonly status: "excluded"; readonly pattern: string }
	/** A link that loops back to an ancestor or points at nothing, which Rojo must never walk. */
	| { readonly status: "skipped" };

export interface ScannedRoot {
	readonly rootDir: string;
	/** False for a root dir the index doesn't hold, which contributes nothing. */
	readonly exists: boolean;
	readonly entries: readonly ScannedEntry[];
	readonly markers: readonly string[];
	/** `.meta.json` files, `init.meta.json` included; Rojo applies them, they're never entries. */
	readonly metaFiles: readonly string[];
	/** The paths the scan left out, by absolute POSIX path. */
	readonly leftOut: ReadonlyMap<string, ScanLeftOut>;
}
