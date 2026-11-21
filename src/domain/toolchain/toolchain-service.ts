import { createDecorator } from "../../platform/instantiation/instantiation.js";
import { DetectedWorkspace, SyncTool } from "./toolchain.js";
import { ToolManifest } from "./tool-manifest.js";

export interface ToolchainService {
	readonly _serviceBrand: undefined;

	readonly syncTools: readonly SyncTool[];

	detect(directory: string): Promise<DetectedWorkspace>;

	readManifests(directory: string): Promise<readonly ToolManifest[]>;
}

export const ToolchainService =
	createDecorator<ToolchainService>("toolchainService");
