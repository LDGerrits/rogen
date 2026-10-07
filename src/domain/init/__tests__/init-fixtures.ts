import path from "path";
import { Result } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	WorkspaceSpec,
	workspaceOf,
} from "../../toolchain/__tests__/workspaces.js";
import { PlannedFile } from "../../toolchain/toolchain.js";
import { TEMPLATE_FILE } from "../config-set.js";
import { BaseConfig, InitDirectory } from "../init-directory.js";
import { InitPlanBuilder, Setup } from "../init-plan-builder.js";
import { InitPlan, NextSteps } from "../init-service.js";

export const directory = path.resolve("/mock/my-game");

export interface DirectorySpec {
	readonly workspace?: WorkspaceSpec;
	readonly existing?: readonly string[];
	readonly givenName?: string;
	/** What a place inherits from `default.rogen.json`. */
	readonly base?: Result<BaseConfig, Diagnostic[]>;
	readonly path?: string;
}

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
