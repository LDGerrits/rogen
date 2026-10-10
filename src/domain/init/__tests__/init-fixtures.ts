import path from "path";
import { Result } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../../platform/fs/file-system-service.js";
import { MemoryFileSystemService } from "../../../platform/fs/memory-file-system-service.js";
import {
	WorkspaceSpec,
	workspaceOf,
} from "../../toolchain/__tests__/workspaces.js";
import { CoreToolchainService } from "../../toolchain/core-toolchain-service.js";
import { PlannedFile } from "../../toolchain/toolchain.js";
import { TEMPLATE_FILE } from "../config-set.js";
import { BaseConfig, InitDirectory } from "../init-directory.js";
import { InitPlanBuilder, Setup } from "../init-plan-builder.js";
import { InitPlan, NextSteps } from "../init-service.js";
import { PlaceFolders } from "../place-folder.js";

export const directory = path.resolve("/mock/my-game");

export interface DirectorySpec {
	readonly workspace?: WorkspaceSpec;
	readonly existing?: readonly string[];
	readonly givenName?: string;
	/** What a place inherits from `default.rogen.json`. */
	readonly base?: Result<BaseConfig, Diagnostic[]>;
	readonly path?: string;
}

/** What a setup reads folders through, over `fileSystem`. */
export const placeFoldersOf = (
	fileSystem: FileSystemService = new MemoryFileSystemService()
) => new PlaceFolders(fileSystem, new CoreToolchainService(fileSystem));

export function directoryOf(spec: DirectorySpec = {}): InitDirectory {
	return new InitDirectory(
		spec.path ?? directory,
		new Set(spec.existing ?? []),
		workspaceOf(spec.workspace),
		spec.givenName,
		spec.givenName ?? "default",
		spec.base
	);
}

export interface LegacyPlan {
	readonly template?: PlannedFile;
	readonly configs: readonly PlannedFile[];
	readonly placeTemplates: readonly PlannedFile[];
	readonly compilerConfigs: readonly PlannedFile[];
	readonly notes: readonly string[];
	readonly nextSteps: NextSteps;
}

export const legacyPlan = ({
	files,
	notes,
	nextSteps,
}: InitPlan): LegacyPlan => {
	const [first] = files;
	const template = first?.fileName.endsWith(TEMPLATE_FILE)
		? first
		: undefined;
	const others = files.filter((file) => file !== template);
	return {
		template,
		configs: others.filter(({ fileName }) =>
			fileName.endsWith(".rogen.json")
		),
		placeTemplates: others.filter(({ fileName }) =>
			fileName.endsWith(".project.json")
		),
		compilerConfigs: others.filter(
			({ fileName }) =>
				!fileName.endsWith(".rogen.json") &&
				!fileName.endsWith(".project.json")
		),
		notes,
		nextSteps,
	};
};

/** What `setup` plans for `choices` in `target`. */
export function planOf<C>(
	setup: Setup<C>,
	choices: C,
	target: InitDirectory
): Result<InitPlan, Diagnostic[]> {
	const builder = new InitPlanBuilder(target, false);
	setup.plan(choices, builder);
	return builder.build();
}
