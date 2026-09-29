import path from "path";
import { formatJsonFile } from "../../base/json.js";
import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	configFileName,
	DEFAULT_CONFIG_STEM,
} from "../config/config-discovery.js";
import { RogenConfig } from "../config/config.js";
import { schemaUrlFor } from "../config/schema-url.js";
import { Language, PLACES_DIR, PlannedFile } from "../toolchain/toolchain.js";
import { projectFileName } from "../rojo/rojo-project.js";
import { TEMPLATE_FILE } from "./template.js";

export const DEFAULT_CONFIG_FILE = configFileName(DEFAULT_CONFIG_STEM);
export const SCHEMA_URL = schemaUrlFor("2.0.0");

export const InitDiagnostics = {
	configExists: (location: DiagnosticLocation) =>
		errorDiagnostic(
			"init.configExists",
			location,
			"this config already exists. Delete it to write a new one."
		),
	templateUnreadable: (location: DiagnosticLocation, detail: string) =>
		errorDiagnostic(
			"init.templateUnreadable",
			location,
			`couldn't read this file to copy it: ${detail}`
		),
};

export const placeFolder = (name: string): string => `${PLACES_DIR}/${name}`;

export const configFile = (stem: string, config: RogenConfig): PlannedFile => ({
	fileName: configFileName(stem),
	content: formatJsonFile(config),
});

/** `extends` as init writes it: relative, and explicitly so. */
export const extendsRef = (file: string): string => `./${file}`;

/**
 * Whether the configs for a name come as a pair: a source config rooted at
 * the root dirs, and the synced one extending it. A processor that reads the
 * root dirs themselves, rather than a compiler's output, resolves requires
 * from the source-rooted project.
 */
export const hasSourceConfig = (
	language: Language,
	darklua: boolean
): boolean => darklua && language.compiler === undefined;

export const sourceStemOf = (name: string): string =>
	name === DEFAULT_CONFIG_STEM ? "source" : `${name}-source`;

const configStems = (name: string, language: Language, darklua: boolean) =>
	hasSourceConfig(language, darklua) ? [sourceStemOf(name), name] : [name];

/** Every config file `init` writes for `name`. */
export const configFileNames = (
	name: string,
	language: Language,
	darklua: boolean
): string[] => configStems(name, language, darklua).map(configFileName);

/** The project files the configs for `name` write, the synced one first. */
export const outputFileNames = (
	name: string,
	language: Language,
	darklua: boolean
): string[] =>
	configStems(name, language, darklua).reverse().map(projectFileName);

/** The files a place named `name` writes, plus its project file, which mustn't exist either. */
export const placeFileNames = (
	name: string,
	language: Language,
	darklua: boolean
): string[] => [
	configFileName(name),
	...(hasSourceConfig(language, darklua)
		? [configFileName(`${name}-source`)]
		: []),
	...(language.compiler?.placeFileNames(name) ?? []),
	projectFileName(name),
];

/** The files a variant named `name` writes, plus its project file. */
export const variantFileNames = (name: string): string[] => [
	configFileName(name),
	projectFileName(name),
];

/** `names` are the positionals after `init`. */
export function parseInitName(names: readonly string[]): Result<string, Error> {
	if (names.length > 1) {
		return err(new Error("init takes at most one config name."));
	}
	const [name = DEFAULT_CONFIG_STEM] = names;
	if (name.trim() === "") {
		return err(new Error("A config name can't be empty."));
	}
	if (name === "." || name === ".." || /[\\/]/.test(name)) {
		return err(
			new Error(
				`"${name}" is not a valid config name: it can't contain path separators.`
			)
		);
	}
	if (projectFileName(name) === TEMPLATE_FILE) {
		return err(
			new Error(
				`"${name}" is not a valid config name: it would write over ${TEMPLATE_FILE}.`
			)
		);
	}
	return ok(name);
}

/** One diagnostic per file in `fileNames` that already exists in `directory`. */
export const existingFileDiagnostics = (
	fileNames: readonly string[],
	directory: string,
	existingFiles: ReadonlySet<string>
): Diagnostic[] =>
	fileNames
		.filter((fileName) => existingFiles.has(fileName))
		.map((fileName) =>
			InitDiagnostics.configExists({
				resource: path.join(directory, fileName),
			})
		);
