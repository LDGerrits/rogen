import {
	DiagnosticLocation,
	errorDiagnostic as error,
} from "../diagnostics/diagnostic.js";

export const UNREADABLE_CONFIG_CODE = "config.unreadable";

export const ConfigFileDiagnostics = {
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
			UNREADABLE_CONFIG_CODE,
			location,
			`the config could not be read: ${detail}.`
		),
};
