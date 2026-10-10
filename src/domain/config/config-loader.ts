import path from "path";
import { Disposable } from "../../base/disposable.js";
import { parse } from "../../base/jsonc.js";
import { Result, err, ok, tryWithAsync } from "../../base/result.js";
import {
	ConfigFile,
	ConfigFileFailure,
	ConfigFileReader,
} from "../../platform/config/config-file.js";
import { Config } from "../../platform/config/config-models.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import {
	FileSystemService,
	failureReason,
	isMissingPath,
} from "../../platform/fs/file-system-service.js";
import { RojoProject } from "../rojo/rojo-project.js";
import { configSchema, configWrongTypeAdvice } from "./config-schema.js";
import { ConfigFileCheck } from "./config-service.js";
import { CONFIG_SUFFIX, ResolvedConfig, ResolvedTemplate } from "./config.js";
import { ConfigOverrides, LayeredConfig } from "./layered-config.js";
import { ConfigValidator } from "./config-validator.js";

/** One read of one config, with everything a reload needs to compare against. */
export interface LoadedConfig {
	/** The leaf first, then each parent; includes a file that failed to load. */
	readonly chain: readonly string[];
	/** Every file the config reads: its chain and its template. */
	readonly files: readonly string[];
	/** The merged layers, once the chain could be read. */
	readonly config?: Config;
	/** The CLI variants this config doesn't declare; `undefined` when its chain could not be read. */
	readonly skippedVariants?: readonly string[];
	/** The modes its chain declares; `undefined` when the chain could not be read. */
	readonly modes?: readonly string[];
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
	private readonly fileChecks = new Set<ConfigFileCheck>();

	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly environmentService: EnvironmentService
	) {
		this.reader = new ConfigFileReader(
			fileSystemService,
			configSchema,
			configWrongTypeAdvice
		);
	}

	registerFileCheck(check: ConfigFileCheck): Disposable {
		this.fileChecks.add(check);
		return { [Symbol.dispose]: () => this.fileChecks.delete(check) };
	}

	/** Never throws for a problem the user can cause. */
	async load(
		file: string,
		overrides: ConfigOverrides
	): Promise<LoadedConfig> {
		if (path.basename(file) === CONFIG_SUFFIX) {
			return {
				chain: [file],
				files: [file],
				resolved: err([
					errorDiagnostic(
						"config.unnamed",
						{ resource: file },
						`a config file needs a name before "${CONFIG_SUFFIX}". Rename it to <name>${CONFIG_SUFFIX}, such as default${CONFIG_SUFFIX}.`
					),
					...(await this.hintsFor(file)),
				]),
			};
		}
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
		const templates = layered.templates();
		const loaded = {
			chain: chain.files,
			files: [...chain.files, ...templates.map(({ file }) => file)],
			skippedVariants: layered.skippedVariants,
			modes: layered.modes,
		};

		let template: ResolvedTemplate | undefined;
		for (const { file, location } of templates) {
			const read = await this.readTemplate(file, location);
			if (read.isErr()) return { ...loaded, resolved: read };
			template = template ? read.value.over(template) : read.value;
		}

		const resolved = new ConfigValidator(
			layered,
			chain.files.slice(1)
		).validate(template);
		return {
			...loaded,
			...(resolved.isOk() && { config: layered.config }),
			resolved,
		};
	}

	/** What a config of the chain that failed to load says: a missing or unreadable `extends` target is told at the config that names it. */
	private async failureDiagnostics(
		failure: ConfigFileFailure,
		current: string,
		written: string,
		referrer: DiagnosticLocation | undefined
	): Promise<Diagnostic[]> {
		if (failure.kind === "invalid")
			return [...failure.diagnostics, ...(await this.hintsFor(current))];
		if (!referrer) return [...failure.diagnostics];
		return [
			errorDiagnostic(
				"config.extendsUnreadable",
				referrer,
				failure.missing
					? `"extends" target "${written}" does not exist (looked for ${current}). Paths are relative to this config.`
					: `"extends" target "${written}" could not be read: ${failure.reason}.`
			),
		];
	}

	private async readChain(file: string): Promise<ConfigChain> {
		const files: string[] = [];
		const layers: ConfigFile[] = [];
		let current = file;
		let referrer: DiagnosticLocation | undefined;
		/** The target as the config wrote it. */
		let written = "";

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
				return {
					files,
					layers,
					diagnostics: await this.failureDiagnostics(
						loaded.error,
						current,
						written,
						referrer
					),
				};
			}

			const layer = loaded.value;
			layers.push(layer);
			const parent = layer.model.getValue<string>("extends");
			if (parent === undefined) return { files, layers, diagnostics: [] };
			written = parent;

			referrer = {
				resource: layer.file,
				position: layer.positionOf("extends"),
			};
			current = path.resolve(path.dirname(current), parent);
		}
	}

	/** What the registered checks add to a file that failed to load. */
	private async hintsFor(file: string): Promise<Diagnostic[]> {
		if (this.fileChecks.size === 0) return [];
		const text = await tryWithAsync(() =>
			this.fileSystemService.readFile(file)
		);
		const parsed = text.isOk() ? parse(text.value) : undefined;
		const value = parsed?.isOk() ? parsed.value : undefined;
		return [...this.fileChecks].flatMap((check) => [
			...check({ file, value }),
		]);
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
					isMissingPath(text.error)
						? `the template does not exist (looked for ${file}). Paths are relative to the config that sets them.`
						: `the template could not be read: ${failureReason(text.error)}.`
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
