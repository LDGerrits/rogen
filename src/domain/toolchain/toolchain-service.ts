import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { SyncTool } from "../build/build.js";
import { DetectedWorkspace } from "./toolchain.js";

/** The languages and tools Rogen knows and what a workspace uses of them. */
export interface ToolchainService {
	readonly _serviceBrand: undefined;

	/** What each tool that writes a sync dir tells a build, which names none of them; the composition root hands them to the build. */
	readonly syncTools: readonly SyncTool[];

	/** What `directory` uses: facts only, never decisions. Only `init` asks; builds do what the config says. */
	detect(directory: string): Promise<DetectedWorkspace>;

	/** Whether `directory` holds a script anywhere below it, outside hidden and vendored folders. */
	holdsCode(directory: string): Promise<boolean>;
}

export const ToolchainService =
	createServiceIdentifier<ToolchainService>("toolchainService");
