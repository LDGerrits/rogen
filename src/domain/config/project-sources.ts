import path from "path";
import { mergeByKey, isObject } from "../../base/objects.js";
import { ConfigFile } from "../../platform/config/config-file.js";
import {
	ConfigModel,
	ConfigSection,
	sectionPath,
} from "../../platform/config/config-models.js";
import {
	Diagnostic,
	DiagnosticPosition,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ConfigKeys } from "./config-keys.js";
import {
	DEFAULT_PROJECT,
	PLACE_OWN_KEYS,
	PROJECT_NAME,
	ROOT_ONLY_KEYS,
} from "./config.js";
import { PathRebaser } from "./path-rebaser.js";

interface InheritedSource {
	readonly dir: string;
	readonly sourcePaths?: readonly string[];
	/** Whether the project's `syncRules` are the ones it takes from there, so their patterns are relative to `dir`. */
	readonly syncRules: boolean;
}

/** The values of one project to write, and where in the config file each came from. */
export interface ProjectSource {
	readonly file: string;
	/** `default`, or the name of an entry of `projects`. */
	readonly stem: string;
	readonly model: ConfigModel;
	readonly inherited?: InheritedSource;
	readonly warnings: readonly Diagnostic[];
	positionOf(section: ConfigSection): DiagnosticPosition | undefined;
	positionOfKey(key: string): DiagnosticPosition | undefined;
}

interface ProjectSources {
	readonly sources: readonly ProjectSource[];
	readonly errors: readonly Diagnostic[];
	readonly serveProject: string;
}

/** The listing config's sources, which a place builds on. */
export interface PlaceBase {
	readonly dir: string;
	/** One per project of the listing config, `default` first. */
	readonly sources: readonly ProjectSource[];
	readonly serveProject: string;
}

/** Reads a config's projects: each entry of `projects` applied to the description; a place applies it on what it takes from `base`. */
export class ProjectSourceReader {
	private readonly dir: string;
	private readonly description: Record<string, unknown>;

	constructor(
		private readonly config: ConfigFile,
		private readonly base?: PlaceBase
	) {
		this.dir = path.dirname(config.file);
		this.description = Object.fromEntries(
			Object.entries(config.model.contents).filter(
				([key]) => key !== "$schema" && !ROOT_ONLY_KEYS.includes(key)
			)
		);
	}

	read(): ProjectSources {
		const errors: Diagnostic[] = [...this.placeErrors()];
		const declared = this.declaredProjects(errors);
		const sources = this.inOrder(declared);
		const serveProject = this.serveProject(sources, errors);
		return { sources, errors, serveProject };
	}

	private placeErrors(): Diagnostic[] {
		const { config, base } = this;
		return base && config.model.keys.includes("placePaths")
			? [
					errorDiagnostic(
						"config.placeListsPlaces",
						{
							resource: config.file,
							position: config.positionOfKey("placePaths"),
						},
						'a place can\'t list places: "placePaths" belongs to the config that lists this folder. Remove it.'
					),
				]
			: [];
	}

	private declaredProjects(errors: Diagnostic[]): Map<string, ProjectSource> {
		const { config, base } = this;
		const declared =
			config.model.getValue<Record<string, unknown>>("projects");
		const sources = new Map<string, ProjectSource>();
		const named = new Set<string>(
			base?.sources.slice(1).map(({ stem }) => stem) ?? []
		);
		for (const [name, changes] of Object.entries(declared ?? {})) {
			const at = (...section: string[]) =>
				config.positionOf(["projects", name, ...section]);
			const problem = this.nameProblem(name, named, at);
			if (problem) {
				errors.push(problem);
				continue;
			}
			named.add(name);
			if (!isObject(changes)) continue;
			sources.set(name, this.projectSource(name, changes, at, errors));
		}
		return sources;
	}

	private nameProblem(
		name: string,
		named: ReadonlySet<string>,
		at: (...section: string[]) => DiagnosticPosition | undefined
	): Diagnostic | undefined {
		const location = { resource: this.config.file, position: at() };
		if (name.toLowerCase() === DEFAULT_PROJECT)
			return errorDiagnostic(
				"config.reservedProject",
				location,
				name === DEFAULT_PROJECT
					? `"${DEFAULT_PROJECT}" is the description itself, written as ${DEFAULT_PROJECT}.project.json, so it can't name a project. Pick another name.`
					: `"${name}" would write ${DEFAULT_PROJECT}.project.json on Windows and macOS, where file names ignore letter case, and that file is the description itself. Pick another name.`
			);
		if (!PROJECT_NAME.test(name))
			return errorDiagnostic(
				"config.invalidProjectName",
				location,
				`project name "${name}" is invalid: it is the stem of ${name}.project.json, so use letters, digits, "-" and "_", starting with a letter or digit.`
			);
		const clash = [...named].find(
			(other) =>
				other !== name && other.toLowerCase() === name.toLowerCase()
		);
		return clash === undefined
			? undefined
			: errorDiagnostic(
					"config.ambiguousProject",
					location,
					`"${name}" and "${clash}" differ only in letter case, so on Windows and macOS both would write the same project file. Keep one of them.`
				);
	}

	private projectSource(
		name: string,
		changes: Record<string, unknown>,
		at: (...section: string[]) => DiagnosticPosition | undefined,
		errors: Diagnostic[]
	): ProjectSource {
		const { config } = this;
		const location = (...section: string[]) => ({
			resource: config.file,
			position: at(...section),
		});
		const keys = Object.keys(changes);
		for (const key of keys.filter((key) => ROOT_ONLY_KEYS.includes(key)))
			errors.push(
				errorDiagnostic(
					"config.projectKey",
					location(key),
					`"${key}" is set once for the whole config, not by a project. Move it out of "${name}".`
				)
			);
		const found = ConfigKeys.check(
			keys.filter((key) => !ROOT_ONLY_KEYS.includes(key)),
			(key) => location(key)
		);
		errors.push(...found.errors);
		return {
			file: config.file,
			stem: name,
			model: new ConfigModel(
				mergeByKey(
					this.startingValues(name),
					Object.fromEntries(
						Object.entries(changes).filter(
							([key]) => !ROOT_ONLY_KEYS.includes(key)
						)
					)
				)
			),
			inherited: this.inheritedFrom(name, changes),
			warnings: found.warnings,
			positionOf: (section) =>
				at(...sectionPath(section)) ?? config.positionOf(section),
			positionOfKey: (key) => at(key) ?? config.positionOfKey(key),
		};
	}

	/** `default` first, then the listing config's projects in its order, then those only this config declares. */
	private inOrder(declared: Map<string, ProjectSource>): ProjectSource[] {
		const { config, base } = this;
		const unchanged = (stem: string): ProjectSource => ({
			...config,
			stem,
			model: new ConfigModel(this.startingValues(stem)),
			inherited: this.inheritedFrom(stem),
			warnings: [],
		});
		const description: ProjectSource = {
			...config,
			stem: DEFAULT_PROJECT,
			model: base
				? new ConfigModel(this.startingValues(DEFAULT_PROJECT))
				: config.model,
			inherited: this.inheritedFrom(DEFAULT_PROJECT),
			warnings: [],
		};
		const inherited = (base?.sources.slice(1) ?? []).map(
			({ stem }) => declared.get(stem) ?? unchanged(stem)
		);
		const own = [...declared.values()].filter(
			({ stem }) => !base?.sources.some((source) => source.stem === stem)
		);
		return [description, ...inherited, ...own];
	}

	private serveProject(
		sources: readonly ProjectSource[],
		errors: Diagnostic[]
	): string {
		const { config, base } = this;
		const serveProject =
			config.model.getValue<string>("serveProject") ??
			base?.serveProject ??
			DEFAULT_PROJECT;
		if (!sources.some(({ stem }) => stem === serveProject))
			errors.push(
				errorDiagnostic(
					"config.unknownServeProject",
					{
						resource: config.file,
						position: config.positionOfKey("serveProject"),
					},
					`"serveProject" names "${serveProject}", which is not a project. Use ${sources.map(({ stem }) => `"${stem}"`).join(", ")}.`
				)
			);
		return serveProject;
	}

	private listedSource(stem: string): ProjectSource {
		const sources = this.base?.sources ?? [];
		return sources.find((source) => source.stem === stem) ?? sources[0];
	}

	private startingValues(stem: string): Record<string, unknown> {
		const { base } = this;
		if (!base) return this.description;
		const inherited = Object.fromEntries(
			Object.entries(
				PathRebaser.values(
					this.listedSource(stem).model.contents,
					base.dir,
					this.dir
				)
			).filter(
				([key]) =>
					key !== "$schema" &&
					!PLACE_OWN_KEYS.includes(key) &&
					!ROOT_ONLY_KEYS.includes(key)
			)
		);
		return mergeByKey(inherited, this.description);
	}

	private inheritedFrom(
		stem: string,
		changes: Readonly<Record<string, unknown>> = {}
	): InheritedSource | undefined {
		const { base } = this;
		return (
			base && {
				dir: base.dir,
				sourcePaths:
					this.listedSource(stem).model.getValue<string[]>(
						"sourcePaths"
					),
				syncRules:
					this.description.syncRules === undefined &&
					changes.syncRules === undefined,
			}
		);
	}
}
