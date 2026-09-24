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
};
