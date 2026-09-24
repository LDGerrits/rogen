import {
	DiagnosticLocation,
	errorDiagnostic as error,
} from "../../platform/diagnostics/diagnostic.js";

export const ConfigDiagnostics = {
	extendsUnreadable: (
		location: DiagnosticLocation,
		target: string,
		detail: string
	) =>
		error(
			"config.extendsUnreadable",
			location,
			`"extends" target "${target}": ${detail}`
		),
	extendsCycle: (location: DiagnosticLocation, loop: readonly string[]) =>
		error(
			"config.extendsCycle",
			location,
			`extends cycle: ${loop.join(" -> ")}.`
		),
};
