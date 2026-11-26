import { Language, Mount, PlannedFile } from "../toolchain/toolchain.js";
import { WrittenTree } from "../rojo/project-text.js";
import { DerivedRoutes } from "./derived-routes.js";
import { InitPlanBuilder } from "./init-plan-builder.js";
import { InitKind } from "./init-service.js";
import { ProjectTree } from "./tree-plan.js";

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

export interface SetupProject {
	readonly kind: InitKind;
	readonly tree: ProjectTree;
	readonly code: ProjectCode;
	readonly writes: ProjectWrites;
	readonly takesRoutes: boolean;
	readonly mountedFolders: readonly string[];
	readonly configFile: string;
	readonly projectFile: string;
	readonly name?: string;
	readonly outputPrefix?: string;
	readonly written?: WrittenTree;
	readonly processedPath?: string;
	readonly capturedKeys?: readonly string[];
	readonly unmounted?: readonly string[];
	derivedRoutes?(dirs: readonly string[]): DerivedRoutes | undefined;
	summarise(builder: InitPlanBuilder, shown: ReadonlySet<string>): void;
	plan(builder: InitPlanBuilder, code: CodePlan): void;
}
