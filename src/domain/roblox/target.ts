import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
} from "../../platform/diagnostics/diagnostic.js";
import { RobloxDiagnostics } from "./roblox-diagnostics.js";
import { SupportedService, isSupportedService } from "./services.js";

export interface Target {
	readonly service: SupportedService;
	readonly folders: readonly string[];
}

/** `location` is where the target was written, for the diagnostic. */
export function parseTarget(
	target: string,
	location: DiagnosticLocation
): Result<Target, Diagnostic[]> {
	const [service, ...folders] = target.split("/");
	if (!isSupportedService(service)) {
		return err([RobloxDiagnostics.unsupportedService(location, service)]);
	}
	return ok({ service, folders });
}
