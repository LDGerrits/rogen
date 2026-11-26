import { Language, Mount, PlannedFile } from "../toolchain/toolchain.js";

export const LISTED_SHOWN = 5;

export interface ProjectCode {
	readonly language: Language;
	readonly sourcePaths: readonly string[];
	readonly compiledPath?: string;
	readonly mounts: readonly Mount[];
	readonly keySpellings: ReadonlyMap<string, string>;
	readonly outside: readonly string[];
}

export interface ProjectWrites {
	readonly files: readonly PlannedFile[];
	readonly emptyFolders: readonly string[];
	readonly skipGit: boolean;
	readonly projectFilesHint?: string;
}

export interface CodePlan {
	readonly notes: readonly string[];
	readonly othersNote?: string;
	readonly compilerNote?: string;
	readonly edits: readonly string[];
	readonly configEdit: string;
	readonly folderName: string;
	readonly tracksProjectFile: boolean;
}
