import {
	DiagnosticLocation,
	errorDiagnostic as error,
} from "../../platform/diagnostics/diagnostic.js";

const NAME_RULE = "use letters and digits only, starting with a letter";

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
	templateUnreadable: (location: DiagnosticLocation, detail: string) =>
		error(
			"config.templateUnreadable",
			location,
			`the template could not be read: ${detail}.`
		),
	templateInvalid: (location: DiagnosticLocation, detail: string) =>
		error(
			"config.templateInvalid",
			location,
			`the template is not a valid Rojo project file: ${detail}`
		),
	invalidRouteKey: (location: DiagnosticLocation, key: string) =>
		error(
			"config.invalidRouteKey",
			location,
			`route key "${key}" is invalid: ${NAME_RULE}.`
		),
	invalidTagName: (location: DiagnosticLocation, name: string) =>
		error(
			"config.invalidTagName",
			location,
			`tag "${name}" is invalid: ${NAME_RULE}.`
		),
	tagClashesWithRoute: (location: DiagnosticLocation, name: string) =>
		error(
			"config.tagClashesWithRoute",
			location,
			`tag "${name}" has the same name as a route key; rename one of them.`
		),
	ambiguousKey: (
		location: DiagnosticLocation,
		name: string,
		other: string
	) =>
		error(
			"config.ambiguousKey",
			location,
			`"${name}" and "${other}" differ only in the case of their first letter, so both would match the same names; keep one of them.`
		),
	outFileIsTemplate: (location: DiagnosticLocation, file: string) =>
		error(
			"config.outFileIsTemplate",
			location,
			`the output file ${file} is also the template, and a build would overwrite it. Set "outFile" to another path.`
		),
	nestedRootDir: (
		location: DiagnosticLocation,
		inner: string,
		outer: string
	) =>
		error(
			"config.nestedRootDir",
			location,
			`root dir "${inner}" is inside root dir "${outer}"; a file under it would belong to both. Remove one.`
		),
};
