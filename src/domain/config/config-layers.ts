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
import { ConfigOverrides } from "./config-service.js";

const LEAF_ONLY_KEYS = ["extends", "$schema", "outFile"];

export interface LayeredConfig {
	readonly config: Config;
	/** The chain from its root to the leaf, matching the layers of `config`. */
	readonly files: readonly ConfigFile[];
	/** The tags the CLI named that no layer declares, so they were left out of `config`. */
	readonly undeclaredTags: readonly string[];
}

export function layerConfig(
	chain: readonly ConfigFile[],
	overrides: ConfigOverrides,
	cwd: string
): LayeredConfig {
	const files = [...chain].reverse();
	const leaf = chain[0];
	const defaults = Registry.as<ConfigRegistry>(
		Extensions.Config
	).getConfigModel();
	const layers = files.map((file) => layerModel(file, file === leaf));

	const declared = new Set(
		layers.flatMap((layer) =>
			Object.keys(layer.getValue<Record<string, boolean>>("tags") ?? {})
		)
	);
	const tagNames = Object.keys(overrides.tags);

	return {
		files,
		undeclaredTags: tagNames.filter((tag) => !declared.has(tag)),
		config: new Config(
			new ConfigModel(
				absolutize(defaults.contents, path.dirname(leaf.file))
			),
			layers,
			cliModel(
				overrides,
				tagNames.filter((tag) => declared.has(tag)),
				cwd
			)
		),
	};
}

function cliModel(
	overrides: ConfigOverrides,
	declaredTags: readonly string[],
	cwd: string
): ConfigModel {
	const contents: Record<string, unknown> = {};
	for (const key of ["outFile", "syncDir", "template"] as const) {
		if (overrides[key] !== undefined) contents[key] = overrides[key];
	}
	if (declaredTags.length > 0) {
		contents.tags = Object.fromEntries(
			declaredTags.map((tag) => [tag, overrides.tags[tag]])
		);
	}
	return new ConfigModel(absolutize(contents, cwd));
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
