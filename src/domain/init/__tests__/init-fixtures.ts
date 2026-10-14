import path from "path";
import { Result } from "../../../base/result.js";
import { Diagnostic } from "../../../platform/diagnostics/diagnostic.js";
import {
	WorkspaceSpec as ToolchainSpec,
	workspaceOf,
} from "../../toolchain/__tests__/workspaces.js";
import { InitDirectory } from "../init-directory.js";
import { InitPlanBuilder } from "../init-plan-builder.js";
import { InitPlan } from "../init-service.js";
import { Setup } from "../setup.js";

export const directory = path.resolve("/mock/my-game");

export interface LayoutSpec {
	readonly codeFolders?: readonly string[];
	readonly hasSrc?: boolean;
}

export type WorkspaceSpec = ToolchainSpec & LayoutSpec;

export interface DirectorySpec {
	readonly workspace?: WorkspaceSpec;
	readonly existing?: readonly string[];
	readonly path?: string;
}

export function directoryOf(spec: DirectorySpec = {}): InitDirectory {
	const { codeFolders = [], hasSrc = false } = spec.workspace ?? {};
	return new InitDirectory(
		spec.path ?? directory,
		new Set([...(spec.existing ?? []), ...(hasSrc ? ["src"] : [])]),
		workspaceOf(spec.workspace),
		{ codeFolders }
	);
}

export function planOf<C>(
	setup: Setup<C>,
	choices: C,
	target: InitDirectory
): Result<InitPlan, Diagnostic[]> {
	const builder = new InitPlanBuilder(target, false, []);
	setup.plan(choices, builder);
	return builder.build();
}
