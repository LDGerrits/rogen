import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { DetectedWorkspace, SyncTool } from "./toolchain.js";
import { ToolManifest } from "./tool-manifest.js";

export interface ToolchainService {
	readonly _serviceBrand: undefined;

	readonly syncTools: readonly SyncTool[];

	/** What `directory` uses: facts only, never decisions. */
	detect(directory: string): Promise<DetectedWorkspace>;

	/** The manifests for `directory` and every folder above it, nearest first. */
	readManifests(directory: string): Promise<readonly ToolManifest[]>;
}

export const ToolchainService =
	createServiceIdentifier<ToolchainService>("toolchainService");
