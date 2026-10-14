import path from "path";
import { mergePatch, isObject } from "../../base/objects.js";
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
import { DEFAULT_PROJECT, PROJECT_NAME, ROOT_ONLY_KEYS } from "./config.js";
import { PathRebaser } from "./path-rebaser.js";

/** What a place takes from the config that lists it. */
export interface InheritedSource {
	/** The folder the listing config is in. */
	readonly dir: string;
	/** The listing config's own `sourcePaths` for the project, as written, when it gives them. */
	readonly sourcePaths?: readonly string[];
}

/** The values of one project to write, and where in the config file each came from. */
export interface ProjectSource {
	readonly file: string;
	/** `default`, or the name of an entry of `projects`. */
	readonly stem: string;
	readonly model: ConfigModel;
	/** Set for a project of a place. */
	readonly inherited?: InheritedSource;
	/** What the keys of the project's own changes warn of. */
	readonly warnings: readonly Diagnostic[];
	positionOf(section: ConfigSection): DiagnosticPosition | undefined;
	positionOfKey(key: string): DiagnosticPosition | undefined;
}

/** What a config says about its projects: one source for each project to write, `default` first, and the problems that keep a project from being one. */
export interface ProjectSources {
	readonly sources: readonly ProjectSource[];
	readonly errors: readonly Diagnostic[];
	/** The project `rogen serve` serves when none is named. */
	readonly serveProject: string;
}

/** The listing config's sources, which a place builds its own on. */
export interface PlaceBase {
	/** The folder the listing config is in. */
	readonly dir: string;
	/** One per project of the listing config, `default` first. */
	readonly sources: readonly ProjectSource[];
	readonly serveProject: string;
}

/** Applies each entry of a config's `projects` to the description; for a place, to what it takes from `base` and its own description. */
export function readProjectSources(
	config: ConfigFile,
	base?: PlaceBase
): ProjectSources {
	const errors: Diagnostic[] = [];
	const description = Object.fromEntries(
		Object.entries(config.model.contents).filter(
			([key]) => key !== "$schema" && !ROOT_ONLY_KEYS.includes(key)
		)
	);
	const dir = path.dirname(config.file);
	if (base && config.model.keys.includes("placePaths"))
		errors.push(
			errorDiagnostic(
				"config.placeListsPlaces",
				{
					resource: config.file,
					position: config.positionOfKey("placePaths"),
				},
				'a place can\'t list places: "placePaths" belongs to the config that lists this folder. Remove it.'
			)
		);

	const taken = (stem: string): ProjectSource => {
		const from = base?.sources.find((source) => source.stem === stem);
		return from ?? (base?.sources[0] as ProjectSource);
	};
	const underlying = (stem: string): Record<string, unknown> => {
		if (!base) return description;
		const inherited = Object.fromEntries(
			Object.entries(
				PathRebaser.values(taken(stem).model.contents, base.dir, dir)
			).filter(
				([key]) =>
					key !== "$schema" &&
					key !== "name" &&
					key !== "sourcePaths" &&
					!ROOT_ONLY_KEYS.includes(key)
			)
		);
		return mergePatch(inherited, description);
	};
	const inheritedFrom = (stem: string): InheritedSource | undefined =>
		base && {
			dir: base.dir,
			sourcePaths: taken(stem).model.getValue<string[]>("sourcePaths"),
		};

	const changesOf = new Map<string, ProjectSource>();
	const declared = config.model.getValue<Record<string, unknown>>("projects");
	const named = new Set<string>(
		base?.sources.slice(1).map(({ stem }) => stem) ?? []
	);

	for (const [name, changes] of Object.entries(declared ?? {})) {
		const at = (...section: string[]) =>
			config.positionOf(["projects", name, ...section]);
		const location = (...section: string[]) => ({
			resource: config.file,
			position: at(...section),
		});
		if (name.toLowerCase() === DEFAULT_PROJECT) {
			errors.push(
				errorDiagnostic(
					"config.reservedProject",
					location(),
					name === DEFAULT_PROJECT
						? `"${DEFAULT_PROJECT}" is the description itself, written as ${DEFAULT_PROJECT}.project.json, so it can't name a project. Pick another name.`
						: `"${name}" would write ${DEFAULT_PROJECT}.project.json on Windows and macOS, where file names ignore letter case, and that file is the description itself. Pick another name.`
				)
			);
			continue;
		}
		if (!PROJECT_NAME.test(name)) {
			errors.push(
				errorDiagnostic(
					"config.invalidProjectName",
					location(),
					`project name "${name}" is invalid: it is the stem of ${name}.project.json, so use letters, digits, "-" and "_", starting with a letter or digit.`
				)
			);
			continue;
		}
		const clash = [...named].find(
			(other) =>
				other !== name && other.toLowerCase() === name.toLowerCase()
		);
		if (clash !== undefined) {
			errors.push(
				errorDiagnostic(
					"config.ambiguousProject",
					location(),
					`"${name}" and "${clash}" differ only in letter case, so on Windows and macOS both would write the same project file. Keep one of them.`
				)
			);
			continue;
		}
		named.add(name);
		if (!isObject(changes)) continue;

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

		changesOf.set(name, {
			file: config.file,
			stem: name,
			model: new ConfigModel(
				mergePatch(
					underlying(name),
					Object.fromEntries(
						Object.entries(changes).filter(
							([key]) => !ROOT_ONLY_KEYS.includes(key)
						)
					)
				)
			),
			inherited: inheritedFrom(name),
			warnings: found.warnings,
			positionOf: (section) =>
				at(...sectionPath(section)) ?? config.positionOf(section),
			positionOfKey: (key) => at(key) ?? config.positionOfKey(key),
		});
	}

	const sources: ProjectSource[] = [
		{
			...config,
			stem: DEFAULT_PROJECT,
			model: base
				? new ConfigModel(underlying(DEFAULT_PROJECT))
				: config.model,
			inherited: inheritedFrom(DEFAULT_PROJECT),
			warnings: [],
		},
	];
	for (const { stem } of base?.sources.slice(1) ?? []) {
		sources.push(
			changesOf.get(stem) ?? {
				...config,
				stem,
				model: new ConfigModel(underlying(stem)),
				inherited: inheritedFrom(stem),
				warnings: [],
			}
		);
		changesOf.delete(stem);
	}
	sources.push(...changesOf.values());

	const serveProject =
		config.model.getValue<string>("serveProject") ??
		base?.serveProject ??
		DEFAULT_PROJECT;
	if (!sources.some(({ stem }) => stem === serveProject)) {
		errors.push(
			errorDiagnostic(
				"config.unknownServeProject",
				{
					resource: config.file,
					position: config.positionOfKey("serveProject"),
				},
				`"serveProject" names "${serveProject}", which is not a project. Use ${["default", ...sources.slice(1).map(({ stem }) => stem)].map((name) => `"${name}"`).join(", ")}.`
			)
		);
	}
	return { sources, errors, serveProject };
}
