import path from "path";
import { ErrorUtils } from "../../base/errors.js";
import { isObject } from "../../base/object.js";
import { parse } from "../../base/jsonc.js";
import { toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import {
	ConfigFile,
	readConfigFile,
} from "../../platform/config/config-file.js";
import { UNREADABLE_CONFIG_CODE } from "../../platform/config/config-file-diagnostics.js";
import {
	Config,
	ConfigModel,
	ConfigSection,
} from "../../platform/config/config-models.js";
import {
	ConfigRegistry,
	Extensions,
} from "../../platform/config/config-registry.js";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { Target } from "../roblox/roblox.js";
import { ConfigDiagnostics } from "./config-diagnostics.js";
import { ConfigOverrides } from "./config-service.js";
import {
	ResolvedConfig,
	ResolvedTemplate,
	configLabel,
	rootDirOverlap,
} from "./config.js";

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

interface ConfigChain {
	/** The leaf first, then each parent. Includes a file that failed to load, so a watcher still sees it. */
	readonly files: readonly string[];
	readonly layers: readonly ConfigFile[];
	readonly diagnostics: readonly Diagnostic[];
}

/** Reads a config file, its `extends` chain and its template, then resolves and validates them. */
export class ConfigLoader {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {}

	/** Never throws for a problem the user can cause. */
	async load(
		file: string,
		overrides: ConfigOverrides
	): Promise<LoadedConfig> {
		const chain = await this.readChain(file);
		if (chain.diagnostics.length > 0) {
			return {
				chain: chain.files,
				files: chain.files,
				resolved: err([...chain.diagnostics]),
			};
		}

		const layered = layerConfig(
			chain.layers,
			overrides,
			this.environmentService.cwd
		);
		const templateFile = layered.config.getValue<string | undefined>(
			"template"
		);
		const loaded = {
			chain: chain.files,
			files: templateFile ? [...chain.files, templateFile] : chain.files,
			undeclaredTags: layered.undeclaredTags,
		};

		const template = templateFile
			? await this.readTemplate(
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

	private async readChain(file: string): Promise<ConfigChain> {
		const files: string[] = [];
		const layers: ConfigFile[] = [];
		let current = file;
		let referrer: DiagnosticLocation | undefined;

		for (;;) {
			const cycleStart = files.indexOf(current);
			if (cycleStart >= 0 && referrer) {
				const cycle = [...files.slice(cycleStart), current];
				return {
					files,
					layers,
					diagnostics: [
						ConfigDiagnostics.extendsCycle(referrer, cycle),
					],
				};
			}

			files.push(current);
			const loaded = await readConfigFile(
				this.fileSystemService,
				current
			);
			if (loaded.isErr()) {
				const from = referrer;
				const target = current;
				return {
					files,
					layers,
					diagnostics: loaded.error.map((diagnostic) =>
						from && diagnostic.code === UNREADABLE_CONFIG_CODE
							? ConfigDiagnostics.extendsUnreadable(
									from,
									target,
									diagnostic.message
								)
							: diagnostic
					),
				};
			}

			const layer = loaded.value;
			layers.push(layer);
			const parent = layer.model.getValue<string>("extends");
			if (parent === undefined) return { files, layers, diagnostics: [] };

			referrer = {
				resource: layer.file,
				position: layer.positionOf("extends"),
			};
			current = path.resolve(path.dirname(current), parent);
		}
	}

	/** `location` is where the config named the template, for the diagnostic. */
	private async readTemplate(
		file: string,
		location: DiagnosticLocation
	): Promise<Result<ResolvedTemplate, Diagnostic[]>> {
		let text: string;
		try {
			text = await this.fileSystemService.readFile(file);
		} catch (error) {
			return err([
				ConfigDiagnostics.templateUnreadable(
					location,
					ErrorUtils.fromUnknown(error).message
				),
			]);
		}

		const parsed = parse(text);
		if (parsed.isErr()) {
			return err([
				ConfigDiagnostics.templateInvalid(
					location,
					parsed.error.message
				),
			]);
		}
		if (!isObject(parsed.value)) {
			return err([
				ConfigDiagnostics.templateInvalid(
					location,
					"it must be a JSON object."
				),
			]);
		}
		return ok({ file, project: parsed.value });
	}
}

const LEAF_ONLY_KEYS = ["extends", "$schema", "outFile"];

interface LayeredConfig {
	readonly config: Config;
	/** The chain from its root to the leaf, matching the layers of `config`. */
	readonly files: readonly ConfigFile[];
	/** The tags the CLI named that no layer declares, so they were left out of `config`. */
	readonly undeclaredTags: readonly string[];
}

function layerConfig(
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

function locateConfigValue(
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

const FALLBACK_NAME = "project";

function resolveConfig(
	layered: LayeredConfig,
	template: ResolvedTemplate | undefined
): Result<ResolvedConfig, Diagnostic[]> {
	const { config, files } = layered;
	const leaf = files[files.length - 1];
	const dir = path.dirname(leaf.file);
	const stem = configLabel(leaf.file);
	const templateName = template?.project.name;

	const resolved: ResolvedConfig = {
		file: leaf.file,
		name:
			(typeof templateName === "string" && templateName) ||
			path.basename(dir) ||
			FALLBACK_NAME,
		rootDirs: config.getValue<string[]>("rootDirs"),
		routes: config.getValue<Record<string, string>>("routes"),
		tags: config.getValue<Record<string, boolean>>("tags"),
		exclude: config.getValue<string[]>("exclude"),
		...(template && { template }),
		syncDir: config.getValue<string | undefined>("syncDir"),
		outFile:
			config.getValue<string | undefined>("outFile") ??
			path.join(dir, projectFileName(stem)),
	};

	const problems = validateConfig(layered, resolved);
	return problems.length > 0 ? err(problems) : ok(resolved);
}

const FALLBACK_ROUTE = "*";
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

/** Keys that share this identity match the same folders, markers and suffixes. */
const matchIdentity = (key: string): string =>
	key.slice(0, 1).toLowerCase() + key.slice(1);

/** Every rule that can be checked without touching the source tree. */
function validateConfig(
	layered: LayeredConfig,
	resolved: ResolvedConfig
): Diagnostic[] {
	const locate = (...section: string[]) =>
		locateConfigValue(layered, section);
	const problems: Diagnostic[] = [];

	const routeKeys = Object.keys(resolved.routes);
	const declared = new Map<string, string>();
	const claim = (key: string, location: DiagnosticLocation) => {
		const other = declared.get(matchIdentity(key));
		if (other === undefined) declared.set(matchIdentity(key), key);
		else
			problems.push(ConfigDiagnostics.ambiguousKey(location, key, other));
	};
	for (const key of routeKeys) {
		const location = locate("routes", key);
		if (key !== FALLBACK_ROUTE && !NAME_PATTERN.test(key)) {
			problems.push(ConfigDiagnostics.invalidRouteKey(location, key));
		} else if (key !== FALLBACK_ROUTE) {
			claim(key, location);
		}
		const target = Target.parse(resolved.routes[key], location);
		if (target.isErr()) problems.push(...target.error);
	}

	for (const tag of Object.keys(resolved.tags)) {
		const location = locate("tags", tag);
		if (!NAME_PATTERN.test(tag)) {
			problems.push(ConfigDiagnostics.invalidTagName(location, tag));
		} else if (routeKeys.includes(tag)) {
			problems.push(ConfigDiagnostics.tagClashesWithRoute(location, tag));
		} else {
			claim(tag, location);
		}
	}

	if (resolved.template?.file === resolved.outFile) {
		const explicit = layered.config.inspect("outFile").source?.tier;
		problems.push(
			ConfigDiagnostics.outFileIsTemplate(
				explicit === "layer" ? locate("outFile") : locate("template"),
				resolved.outFile
			)
		);
	}

	resolved.rootDirs.forEach((rootDir, index) => {
		const overlap = rootDirOverlap(resolved.rootDirs, index);
		if (!overlap) return;
		const location = locate("rootDirs", String(index));
		problems.push(
			overlap.kind === "duplicate"
				? ConfigDiagnostics.duplicateRootDir(location, rootDir)
				: ConfigDiagnostics.nestedRootDir(
						location,
						rootDir,
						overlap.outer
					)
		);
	});

	return problems;
}
