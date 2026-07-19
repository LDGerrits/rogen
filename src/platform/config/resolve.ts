import { createToolchainProvider } from "./providers/toolchain.js";
import { createConfigProvider } from "./providers/config.js";
import { createCliProvider } from "./providers/cli.js";
import { IFileSystem } from "../fs/file-system.js";
import { err, Result } from "../../base/result.js";
import { mergeDeep } from "../../base/object.js";
import { ConfigContext, validateFinalConfig } from "./schema.js";
import { Config } from "./config.js";
import { DEFAULT_CONFIG } from "./defaults.js";

export async function resolveConfig(
	fs: IFileSystem,
	ctx: ConfigContext
): Promise<Result<Config, Error>> {
	// Lowest to highest priority
	const providers = [
		createToolchainProvider(fs),
		createConfigProvider(fs),
		createCliProvider(fs),
	];

	let finalState: Partial<Config> = structuredClone(DEFAULT_CONFIG);

	for (const provider of providers) {
		const result = await provider(ctx);

		if (result.isErr()) {
			return err(result.error);
		}

		finalState = mergeDeep(finalState, result.unwrap());
	}

	return validateFinalConfig(finalState);
}
