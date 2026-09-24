import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { SUPPORTED_SERVICES } from "./services.js";

export const RobloxDiagnostics = {
	unsupportedService: (
		location: DiagnosticLocation,
		segment: string
	): Diagnostic =>
		errorDiagnostic(
			"roblox.unsupportedService",
			location,
			`"${segment}" is not a supported service; a target must start with one of ${SUPPORTED_SERVICES.join(", ")}.`
		),
};
