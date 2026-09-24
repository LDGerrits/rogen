import {
	DiagnosticLocation,
	errorDiagnostic as error,
} from "../../platform/diagnostics/diagnostic.js";

export const ConfigDiagnostics = {
	invalidSyntax: (location: DiagnosticLocation, detail: string) =>
		error("config.invalidSyntax", location, `invalid JSONC: ${detail}.`),
	notAnObject: (location: DiagnosticLocation) =>
		error(
			"config.notAnObject",
			location,
			"a config must be a JSON object."
		),
	unknownField: (location: DiagnosticLocation, name: string) =>
		error("config.unknownField", location, `unknown field "${name}".`),
	wrongType: (
		location: DiagnosticLocation,
		path: string,
		expected: string,
		found: string
	) =>
		error(
			"config.wrongType",
			location,
			`"${path}": expected ${expected}, found ${found}.`
		),
	unreadable: (location: DiagnosticLocation, detail: string) =>
		error(
			"config.unreadable",
			location,
			`the config could not be read: ${detail}.`
		),
	extendsUnreadable: (
		location: DiagnosticLocation,
		target: string,
		detail: string
	) =>
		error(
			"config.extendsUnreadable",
			location,
			`"extends" target "${target}" could not be read: ${detail}.`
		),
	extendsCycle: (location: DiagnosticLocation, loop: readonly string[]) =>
		error(
			"config.extendsCycle",
			location,
			`extends cycle: ${loop.join(" -> ")}.`
		),
	namedNotFound: (location: DiagnosticLocation, name: string) =>
		error(
			"config.namedNotFound",
			location,
			`config "${name}" not found: that file does not exist.`
		),
	pathNotFound: (location: DiagnosticLocation) =>
		error(
			"config.pathNotFound",
			location,
			"the specified config file does not exist."
		),
	duplicate: (location: DiagnosticLocation) =>
		error(
			"config.duplicate",
			location,
			"this config was named more than once; each config can only be " +
				"built once per invocation."
		),
	directoryUnreadable: (location: DiagnosticLocation, detail: string) =>
		error(
			"config.directoryUnreadable",
			location,
			`could not look for a config file here: ${detail}.`
		),
	noneFound: (location: DiagnosticLocation, lookedFor: string) =>
		error(
			"config.noneFound",
			location,
			`no config file found. Looked for ${lookedFor}. Run "rogen init" to create one.`
		),
	ambiguous: (
		location: DiagnosticLocation,
		defaultName: string,
		candidates: readonly string[]
	) =>
		error(
			"config.ambiguous",
			location,
			`several config files found and none is named ${defaultName}: ` +
				`${candidates.join(", ")}. Run "rogen build <name>" or pass -c ` +
				"to pick one."
		),
};
