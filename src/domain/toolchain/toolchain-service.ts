import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { DetectedWorkspace, Language, SyncTool } from "./toolchain.js";

/** The languages Rogen knows and what a workspace uses of them. */
export interface ToolchainService {
	readonly _serviceBrand: undefined;

	/** What `directory` uses: facts only, never decisions. Only `init` asks; builds do what the config says. */
	detect(directory: string): Promise<DetectedWorkspace>;

	/** @throws Error if `id` isn't a language Rogen knows, which is a programmer error. */
	getLanguage(id: string): Language;

	/** Every language, as the language question lists them. The first is also the one assumed when none is detected. */
	getLanguages(): readonly Language[];

	/** The tools that rewrite code on its way to the sync dir, which a build reads through instead of assuming any. */
	getSyncTools(): readonly SyncTool[];
}

export const ToolchainService =
	createServiceIdentifier<ToolchainService>("toolchainService");
