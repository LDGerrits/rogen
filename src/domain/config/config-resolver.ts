import path from "path";
import { toPosix } from "../../base/path.js";
import {
	Config,
	ConfigModel,
} from "../../platform/config/config-models.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import {
	ConfigRegistry,
	Extensions,
} from "../../platform/config/config-registry.js";
import { Registry } from "../../platform/registry/registry.js";
import { CONFIG_SUFFIX } from "./config-discovery.js";
import { ResolvedConfig } from "./config.js";

const PROJECT_FILE_SUFFIX = ".project.json";
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

export function resolveConfig({ config, files }: LayeredConfig): ResolvedConfig {
	const leaf = files[files.length - 1];
	const stem = path.basename(leaf.file, CONFIG_SUFFIX);

	return {
		rootDirs: config.getValue<string[]>("rootDirs"),
		routes: config.getValue<Record<string, string>>("routes"),
		tags: config.getValue<Record<string, boolean>>("tags"),
		exclude: config.getValue<string[]>("exclude"),
		template: config.getValue<string | undefined>("template"),
		syncDir: config.getValue<string | undefined>("syncDir"),
		outFile:
			config.getValue<string | undefined>("outFile") ??
			path.join(path.dirname(leaf.file), `${stem}${PROJECT_FILE_SUFFIX}`),
	};
}
