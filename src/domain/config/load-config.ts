import { Result, err } from "../../base/result.js";
import { Config } from "../../platform/config/config-models.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { loadConfigChain } from "./config-chain.js";
import { layerConfig, locateConfigValue } from "./config-layers.js";
import { resolveConfig } from "./config-resolver.js";
import { readTemplate } from "./config-template.js";
import { ResolvedConfig } from "./config.js";
import { ConfigOverrides } from "./config-service.js";

/** One read of one config, with everything a reload needs to compare against. */
export interface LoadedConfig {
	/** The leaf first, then each parent; includes a file that failed to load. */
	readonly chain: readonly string[];
	/** Every file the config reads: its chain and its template. */
	readonly files: readonly string[];
	/** The merged layers, once the chain could be read. */
	readonly config?: Config;
	/** The CLI tags this config doesn't declare; `undefined` when its chain could not be read. */
	readonly undeclaredTags?: readonly string[];
	readonly resolved: Result<ResolvedConfig, Diagnostic[]>;
}

/** Reads `file`'s `extends` chain and template, then resolves and validates it. Never throws for a problem the user can cause. */
export async function loadConfig(
	fileSystem: FileSystemService,
	file: string,
	overrides: ConfigOverrides,
	cwd: string
): Promise<LoadedConfig> {
	const chain = await loadConfigChain(fileSystem, file);
	if (chain.diagnostics.length > 0) {
		return {
			chain: chain.files,
			files: chain.files,
			resolved: err([...chain.diagnostics]),
		};
	}

	const layered = layerConfig(chain.layers, overrides, cwd);
	const templateFile = layered.config.getValue<string | undefined>(
		"template"
	);
	const loaded = {
		chain: chain.files,
		files: templateFile ? [...chain.files, templateFile] : chain.files,
		undeclaredTags: layered.undeclaredTags,
	};

	const template = templateFile
		? await readTemplate(
				fileSystem,
				templateFile,
				locateConfigValue(layered, "template")
			)
		: undefined;
	if (template?.isErr()) return { ...loaded, resolved: template };

	const resolved = resolveConfig(
		layered,
		template?.isOk() ? template.value : undefined
	);
	return {
		...loaded,
		...(resolved.isOk() && { config: layered.config }),
		resolved,
	};
}
