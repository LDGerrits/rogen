import { Result, err, ok } from "../../base/result.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { SupportedService, isSupportedService } from "./services.js";

const RobloxDiagnostics = {
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

const STARTER_PLAYER_CONTAINERS: readonly string[] = [
	"StarterPlayerScripts",
	"StarterCharacterScripts",
];

/** The class of a node Rogen creates to hold children: services and StarterPlayer's script containers keep their own, the rest are folders. */
export function containerClassName(instancePath: readonly string[]): string {
	const [service, child] = instancePath;
	if (instancePath.length === 1) return service;
	if (
		instancePath.length === 2 &&
		service === "StarterPlayer" &&
		STARTER_PLAYER_CONTAINERS.includes(child)
	)
		return child;
	return "Folder";
}
