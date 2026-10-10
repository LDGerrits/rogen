/** What a sync tool writes in place of a `.meta.json`. */
export interface MetaReplacement {
	readonly suffix: string;
	/** Says why, in the warning about the meta Rojo no longer applies. */
	readonly note: string;
}

/** What a sync tool does to a data file: it writes a Lua module in its place, which Rojo syncs as a ModuleScript. */
export interface DataReplacement {
	/** What the module's name ends in instead of the data file's extension. */
	readonly suffix: string;
	/** Says which data files, in the warning about the file Rojo no longer finds. */
	readonly note: string;
}

/** A tool that rewrites code between the root dirs and the sync dir, which Rojo reads in their place; the build asks it, and never names one. */
export interface SyncTool {
	readonly id: string;
	/** The path the tool writes for a source path, when it renames it. */
	emittedPath?(source: string): string;
	/** Whether the tool reads a source but never writes anything for it. */
	readsOnly?(source: string): boolean;
	/** A script name the tool writes as Rojo's `init`, which makes the file its folder too. */
	readonly initName?: string;
	/** What it writes instead of a `.meta.json`, which Rojo then no longer applies. */
	readonly metaReplacement?: MetaReplacement;
	/** What it writes instead of a data file, such as a `.txt`, which Rojo then no longer finds. */
	readonly dataReplacement?: DataReplacement;
}
