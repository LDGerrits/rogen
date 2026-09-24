import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";

export const RobloxDiagnostics = {
	unsupportedService: (
		location: DiagnosticLocation,
		segment: string
	): Diagnostic =>
		errorDiagnostic(
			"roblox.unsupportedService",
			location,
			`"${segment}" is not a supported service; a target must start with a service Rojo can write to, such as ServerScriptService or ReplicatedStorage.`
		),
};
