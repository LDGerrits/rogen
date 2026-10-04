import path from "path";
import { toPosix } from "../../base/path.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	ConfigFile,
	ConfigFileReader,
} from "../../platform/config/config-file.js";
import {
	Config,
	ConfigModel,
	ConfigSection,
} from "../../platform/config/config-models.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { Target } from "../roblox/roblox.js";
import { RojoProject } from "../rojo/rojo-project.js";
import { configDefaults, configSchema } from "./config-schema.js";
import {
	DeclaredKeys,
	ResolvedConfig,
	ResolvedTemplate,
	configLabel,
	defaultOutFileName,
	rootDirOverlap,
} from "./config.js";

/** Per-invocation values that sit above every layer of a config's chain. */
export interface ConfigOverrides {
	readonly outFile?: string;
	readonly syncDir?: string;
	readonly template?: string;
	/** Tag name to whether it is on. */
	readonly tags: Readonly<Record<string, boolean>>;
}

/** One read of one config, with everything a reload needs to compare against. */
export interface LoadedConfig {
	/** The leaf first, then each parent; includes a file that failed to load. */
	readonly chain: readonly string[];
	/** Every file the config reads: its chain and its template. */
	readonly files: readonly string[];
	/** The merged layers, once the chain could be read. */
	readonly config?: Config;
	/** The CLI tags this config doesn't declare; `undefined` when its chain could not be read. */
	readonly skippedTags?: readonly string[];
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
	private readonly reader: ConfigFileReader;

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {
		this.reader = new ConfigFileReader(fileSystemService, configSchema);
	}

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

		const layered = new LayeredConfig(
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
			skippedTags: layered.skippedTags,
		};

		const template = templateFile
			? await this.readTemplate(templateFile, layered.locate("template"))
			: undefined;
		if (template?.isErr()) return { ...loaded, resolved: template };

		const resolved = new ConfigValidator(
			layered,
			chain.files.slice(1)
		).validate(template?.isOk() ? template.value : undefined);
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
						errorDiagnostic(
							"config.extendsCycle",
							referrer,
							`extends cycle: ${cycle.join(" -> ")}.`
						),
					],
				};
			}

			files.push(current);
			const loaded = await this.reader.read(current);
			if (loaded.isErr()) {
				const { kind, diagnostics } = loaded.error;
				return {
					files,
					layers,
					diagnostics:
						referrer && kind === "unreadable"
							? [
									errorDiagnostic(
										"config.extendsUnreadable",
										referrer,
										`"extends" target "${current}": ${diagnostics[0].message}`
									),
								]
							: diagnostics,
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
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		if (text.isErr()) {
			return err([
				errorDiagnostic(
					"config.templateUnreadable",
					location,
					`the template could not be read: ${text.error.message}.`
				),
			]);
		}

		const project = RojoProject.parse(text.value);
		if (project.isErr()) {
			return err([
				errorDiagnostic(
					"config.templateInvalid",
					location,
					`the template is not a valid Rojo project file: ${project.error.message}`
				),
			]);
		}
		return ok(new ResolvedTemplate(file, project.value));
	}
}

/** A config's chain merged with the defaults and the command line, with each value traceable to the file that set it. */
class LayeredConfig {
	private static readonly LEAF_ONLY_KEYS = ["extends", "$schema", "outFile"];

	readonly config: Config;
	/** The chain from its root to the leaf, matching the layers of `config`. */
	readonly files: readonly ConfigFile[];
	/** The tags the CLI named that no layer declares, so they were left out of `config`. */
	readonly skippedTags: readonly string[];

	/** `chain` is the leaf first, then each parent. */
	constructor(
		chain: readonly ConfigFile[],
		overrides: ConfigOverrides,
		cwd: string
	) {
		this.files = [...chain].reverse();
		const leaf = chain[0];
		const layers = this.files.map((file) =>
			LayeredConfig.layerModel(file, file === leaf)
		);

		const declared = new Set(
			layers.flatMap((layer) =>
				Object.keys(
					layer.getValue<Record<string, boolean>>("tags") ?? {}
				)
			)
		);
		const tagNames = Object.keys(overrides.tags);
		this.skippedTags = tagNames.filter((tag) => !declared.has(tag));
		this.config = new Config(
			new ConfigModel(
				LayeredConfig.absolutize(
					configDefaults.contents,
					path.dirname(leaf.file)
				)
			),
			layers,
			LayeredConfig.cliModel(
				overrides,
				tagNames.filter((tag) => declared.has(tag)),
				cwd
			)
		);
	}

	get leaf(): ConfigFile {
		return this.files[this.files.length - 1];
	}

	/** Where the config set `section`, or the leaf file when nothing did. */
	locate(...section: ConfigSection[]): DiagnosticLocation {
		const path = section.flatMap((part) =>
			typeof part === "string" ? [part] : part
		);
		const { source } = this.config.inspect(path);
		if (source?.tier !== "layer") return { resource: this.leaf.file };
		const file = this.files[source.index];
		return { resource: file.file, position: file.positionOf(path) };
	}

	private static cliModel(
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
		return new ConfigModel(LayeredConfig.absolutize(contents, cwd));
	}

	private static layerModel(file: ConfigFile, isLeaf: boolean): ConfigModel {
		const contents = { ...file.model.contents };
		if (!isLeaf) {
			for (const key of LayeredConfig.LEAF_ONLY_KEYS)
				delete contents[key];
		}
		return new ConfigModel(
			LayeredConfig.absolutize(contents, path.dirname(file.file))
		);
	}

	/** Relative paths resolve against the directory of the file that wrote them. */
	private static absolutize(
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
}

const FALLBACK_NAME = "project";
const NAME_RULE = "use letters and digits only, starting with a letter";

/** Checks every rule on a config's values that doesn't need the source tree, and hands back the config with its route targets parsed. */
class ConfigValidator {
	private readonly problems = new DiagnosticCollector();
	private readonly rootDirs: readonly string[];
	private readonly routes: Readonly<Record<string, string>>;
	private readonly tags: Readonly<Record<string, boolean>>;
	private readonly outFile: string;

	constructor(
		private readonly layered: LayeredConfig,
		private readonly parents: readonly string[]
	) {
		const { config } = layered;
		this.rootDirs = config.getValue<string[]>("rootDirs");
		this.routes = config.getValue<Record<string, string>>("routes");
		this.tags = config.getValue<Record<string, boolean>>("tags");
		this.outFile =
			config.getValue<string | undefined>("outFile") ??
			path.join(
				path.dirname(layered.leaf.file),
				defaultOutFileName(configLabel(layered.leaf.file))
			);
	}

	validate(
		template: ResolvedTemplate | undefined
	): Result<ResolvedConfig, Diagnostic[]> {
		const { config } = this.layered;
		const dir = path.dirname(this.layered.leaf.file);
		const claimed = new Map<string, string>();

		const routes = this.checkRoutes(claimed);
		this.checkTags(claimed);
		this.checkOutFile(template);
		this.checkRootDirs();

		return this.problems.toResult(
			new ResolvedConfig({
				file: this.layered.leaf.file,
				parents: this.parents,
				skippedTags: this.layered.skippedTags,
				name:
					template?.project.name ||
					path.basename(dir) ||
					FALLBACK_NAME,
				rootDirs: this.rootDirs,
				routes,
				tags: this.tags,
				exclude: config.getValue<string[]>("exclude"),
				template,
				syncDir: config.getValue<string | undefined>("syncDir"),
				outFile: this.outFile,
			})
		);
	}

	private checkRoutes(claimed: Map<string, string>): Map<string, Target> {
		const targets = new Map<string, Target>();
		for (const [key, text] of Object.entries(this.routes)) {
			const location = this.layered.locate("routes", key);
			if (key !== DeclaredKeys.FALLBACK_ROUTE) {
				if (DeclaredKeys.isName(key))
					this.claim(claimed, key, location);
				else {
					this.problems.error(
						"config.invalidRouteKey",
						location,
						`route key "${key}" is invalid: ${NAME_RULE}.`
					);
				}
			}
			const target = Target.parse(text, location);
			if (target.isErr()) this.problems.add(target.error);
			else targets.set(key, target.value);
		}
		return targets;
	}

	private checkTags(claimed: Map<string, string>): void {
		for (const tag of Object.keys(this.tags)) {
			const location = this.layered.locate("tags", tag);
			if (!DeclaredKeys.isName(tag)) {
				this.problems.error(
					"config.invalidTagName",
					location,
					`tag "${tag}" is invalid: ${NAME_RULE}.`
				);
			} else if (tag in this.routes) {
				this.problems.error(
					"config.tagClashesWithRoute",
					location,
					`tag "${tag}" has the same name as a route key; rename one of them.`
				);
			} else {
				this.claim(claimed, tag, location);
			}
		}
	}

	private checkOutFile(template: ResolvedTemplate | undefined): void {
		if (template?.file !== this.outFile) return;
		const explicit = this.layered.config.inspect("outFile").source?.tier;
		this.problems.error(
			"config.outFileIsTemplate",
			explicit === "layer"
				? this.layered.locate("outFile")
				: this.layered.locate("template"),
			`the output file ${this.outFile} is also the template, and a build would overwrite it. Set "outFile" to another path.`
		);
	}

	private checkRootDirs(): void {
		this.rootDirs.forEach((rootDir, index) => {
			const overlap = rootDirOverlap(this.rootDirs, index);
			if (!overlap) return;
			const location = this.layered.locate("rootDirs", String(index));
			if (overlap.kind === "duplicate") {
				this.problems.error(
					"config.duplicateRootDir",
					location,
					`root dir "${rootDir}" is listed twice; a file under it would belong to both. Remove one.`
				);
			} else {
				this.problems.error(
					"config.nestedRootDir",
					location,
					`root dir "${rootDir}" is inside root dir "${overlap.outer}"; a file under it would belong to both. Remove one.`
				);
			}
		});
	}

	/** Two keys that differ only in the case of their first letter would match the same names. */
	private claim(
		claimed: Map<string, string>,
		key: string,
		location: DiagnosticLocation
	): void {
		const identity = DeclaredKeys.identityOf(key);
		const other = claimed.get(identity);
		if (other === undefined) claimed.set(identity, key);
		else {
			this.problems.error(
				"config.ambiguousKey",
				location,
				`"${key}" and "${other}" differ only in the case of their first letter, so both would match the same names; keep one of them.`
			);
		}
	}
}
