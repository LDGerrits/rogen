import { RojoNode } from "../rojo/rojo-project.js";
import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";

export interface ToolchainProfile {
	isTs: boolean;
	isWally: boolean;
	isPesde: boolean;
	isDarklua: boolean;
}

export interface WorkspaceService {
	readonly _serviceBrand: undefined;

	detectToolchain(): Promise<ToolchainProfile>;
	injectPackages(
		rootNode: RojoNode,
		toolchain: ToolchainProfile
	): Promise<void>;
}

export const WorkspaceService =
	createServiceIdentifier<WorkspaceService>("workspaceService");
