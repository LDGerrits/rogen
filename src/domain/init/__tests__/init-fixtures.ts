import path from "path";
import { Result } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	MockConfigService,
	mockEntry,
} from "../../config/__tests__/mock-config-service.js";
import {
	WorkspaceSpec,
	workspaceOf,
} from "../../toolchain/__tests__/workspaces.js";
import { PlannedFile } from "../../toolchain/toolchain.js";
import { TEMPLATE_FILE } from "../config-set.js";
import { InitDirectory } from "../init-directory.js";
import { InitPlanBuilder, Setup } from "../init-plan-builder.js";
import { InitPlan, NextSteps } from "../init-service.js";

export const directory = path.resolve("/mock/my-game");

export interface DirectorySpec {
	readonly workspace?: WorkspaceSpec;
	readonly existing?: readonly string[];
	readonly givenName?: string;
	readonly defaultConfig?: {
		readonly rootDirs: readonly string[];
		readonly syncDir?: string;
		readonly parent?: string;
	};
	readonly fileSystem?: MemoryFileSystemService;
	readonly path?: string;
}

export function directoryOf(spec: DirectorySpec = {}): InitDirectory {
	const dir = spec.path ?? directory;
	const file = path.join(dir, "default.rogen.json");
	const absolute = (relative: string) => path.resolve(dir, relative);
	const config = spec.defaultConfig;
	const entry = mockEntry(
		{
			rootDirs: config?.rootDirs.map(absolute) ?? [],
			syncDir: config?.syncDir && absolute(config.syncDir),
		},
		file
	);
	const withParent = {
		...entry,
		parents: config?.parent ? [absolute(config.parent)] : [],
	};
	return new InitDirectory(
		dir,
		new Set(spec.existing ?? []),
		workspaceOf(spec.workspace),
		spec.givenName,
		spec.givenName ?? "default",
		spec.fileSystem ?? new MemoryFileSystemService(),
		new MockConfigService([withParent])
	);
}

export interface LegacyPlan {
	readonly template?: PlannedFile;
	readonly configs: readonly PlannedFile[];
	readonly compilerConfigs: readonly PlannedFile[];
	readonly notes: readonly string[];
	readonly nextSteps: NextSteps;
}

export const legacyPlan = ({
	files,
	notes,
	nextSteps,
}: InitPlan): LegacyPlan => ({
	template: files.find(({ fileName }) => fileName === TEMPLATE_FILE),
	configs: files.filter(({ fileName }) => fileName.endsWith(".rogen.json")),
	compilerConfigs: files.filter(
		({ fileName }) =>
			fileName !== TEMPLATE_FILE && !fileName.endsWith(".rogen.json")
	),
	notes,
	nextSteps,
});

export function planOf(
	setup: Setup,
	target: InitDirectory
): Result<InitPlan, Diagnostic[]> {
	const builder = new InitPlanBuilder(target);
	setup.plan(builder);
	return builder.build();
}
