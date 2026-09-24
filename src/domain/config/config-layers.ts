import path from "path";
import { toPosix } from "../../base/path.js";
import {
	Config,
	ConfigModel,
	ConfigSection,
} from "../../platform/config/config-models.js";
import { DiagnosticLocation } from "../../platform/diagnostics/diagnostic.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import {
	ConfigRegistry,
	Extensions,
} from "../../platform/config/config-registry.js";
import { Registry } from "../../platform/registry/registry.js";

const LEAF_ONLY_KEYS = ["extends", "$schema", "outFile"];

export interface LayeredConfig {
	readonly config: Config;
	/** The chain from its root to the leaf, matching the layers of `config`. */
	readonly files: readonly ConfigFile[];
}

export function layerConfig(chain: readonly ConfigFile[]): LayeredConfig {
	const files = [...chain].reverse();
	const leaf = chain[0];
	const defaults = Registry.as<ConfigRegistry>(
		Extensions.Config
	).getConfigModel();

	return {
		files,
		config: new Config(
			new ConfigModel(
				absolutize(defaults.contents, path.dirname(leaf.file))
			),
			files.map((file) => layerModel(file, file === leaf)),
			new ConfigModel()
		),
	};
}

/** Relative paths resolve against the directory of the file that wrote them. */
function layerModel(file: ConfigFile, isLeaf: boolean): ConfigModel {
	const contents = { ...file.model.contents };
	if (!isLeaf) {
		for (const key of LEAF_ONLY_KEYS) delete contents[key];
	}
	return new ConfigModel(absolutize(contents, path.dirname(file.file)));
}

function absolutize(
	contents: Record<string, unknown>,
	dir: string
): Record<string, unknown> {
	const absolute = (value: string) => path.resolve(dir, value);
	const result = { ...contents };

	for (const key of ["template", "syncDir", "outFile"]) {
		const value = result[key];
		if (typeof value === "string") result[key] = absolute(value);
	}
	if (Array.isArray(result.rootDirs)) {
		result.rootDirs = result.rootDirs.map(absolute);
	}
	if (Array.isArray(result.exclude)) {
		result.exclude = result.exclude.map((glob: string) =>
			path.posix.join(toPosix(dir), glob)
		);
	}
	return result;
}

export function locateConfigValue(
	{ config, files }: LayeredConfig,
	section: ConfigSection
): DiagnosticLocation {
	const { source } = config.inspect(section);
	if (source?.tier !== "layer") {
		return { resource: files[files.length - 1].file };
	}
	const file = files[source.index];
	return { resource: file.file, position: file.positionOf(section) };
}
