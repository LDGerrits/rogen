import { createServiceIdentifier } from "../../platform/instantiation/instantiation.js";
import { DetectedWorkspace, Language } from "./toolchain.js";

/** The languages Rogen knows and what a workspace uses of them. */
export interface ToolchainService {
	readonly _serviceBrand: undefined;

	/** What `directory` uses: facts only, never decisions. Only `init` asks; builds do what the config says. Rejects when no language is registered. */
	detect(directory: string): Promise<DetectedWorkspace>;

	/** @throws Error if `id` isn't registered, which is a programmer error. */
	getLanguage(id: string): Language;

	/** Every registered language, in `order`. */
	getLanguages(): readonly Language[];
}

export const ToolchainService =
	createServiceIdentifier<ToolchainService>("toolchainService");
