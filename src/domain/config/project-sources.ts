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

/** The values of one project to write, and where in the config file each came from. */
export interface ProjectSource {
	readonly file: string;
	/** `default`, or the name of an entry of `projects`. */
	readonly stem: string;
	readonly model: ConfigModel;
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

/** Applies each entry of a config's `projects` to the description. */
export function readProjectSources(config: ConfigFile): ProjectSources {
	const errors: Diagnostic[] = [];
	const description = Object.fromEntries(
		Object.entries(config.model.contents).filter(
			([key]) => key !== "$schema" && !ROOT_ONLY_KEYS.includes(key)
		)
	);
	const sources: ProjectSource[] = [
		{ ...config, stem: DEFAULT_PROJECT, warnings: [] },
	];
	const declared = config.model.getValue<Record<string, unknown>>("projects");

	for (const [name, changes] of Object.entries(declared ?? {})) {
		const at = (...section: string[]) =>
			config.positionOf(["projects", name, ...section]);
		const location = (...section: string[]) => ({
			resource: config.file,
			position: at(...section),
		});
		if (name === DEFAULT_PROJECT) {
			errors.push(
				errorDiagnostic(
					"config.reservedProject",
					location(),
					`"${DEFAULT_PROJECT}" is the description itself, written as ${DEFAULT_PROJECT}.project.json, so it can't name a project. Pick another name.`
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

		const merged = mergePatch(
			description,
			Object.fromEntries(
				Object.entries(changes).filter(
					([key]) => !ROOT_ONLY_KEYS.includes(key)
				)
			)
		);
		sources.push({
			file: config.file,
			stem: name,
			model: new ConfigModel(merged),
			warnings: found.warnings,
			positionOf: (section) =>
				at(...sectionPath(section)) ?? config.positionOf(section),
			positionOfKey: (key) => at(key) ?? config.positionOfKey(key),
		});
	}

	const serveProject =
		config.model.getValue<string>("serveProject") ?? DEFAULT_PROJECT;
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
