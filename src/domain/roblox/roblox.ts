import { Result, err, ok } from "../../base/result.js";
import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	SUPPORTED_SERVICES,
	SupportedService,
	isSupportedService,
} from "./supported-services.js";

const PLAYER_SCRIPT_CONTAINERS: readonly string[] = [
	"StarterPlayerScripts",
	"StarterCharacterScripts",
];

/** The services whose contents never replicate to clients. */
const SERVER_ONLY_SERVICES: readonly string[] = [
	"ServerScriptService",
	"ServerStorage",
];

/** Whether everything in the service stays on the server. */
export function isServerOnlyService(service: string): boolean {
	return SERVER_ONLY_SERVICES.includes(service);
}

/** The services where a legacy Script runs. */
const SERVER_SCRIPT_SERVICES: readonly string[] = [
	"ServerScriptService",
	"Workspace",
];

/** The containers whose LocalScripts run: the player's own, which clone from the Starter containers, and ReplicatedFirst. */
const CLIENT_SCRIPT_SERVICES: readonly string[] = [
	"StarterGui",
	"StarterPack",
	"ReplicatedFirst",
];

/** Whether a legacy Script (`server`) or LocalScript (`client`) at `instancePath` ever runs. */
export function scriptRunsAt(
	scriptClass: "server" | "client",
	instancePath: readonly string[]
): boolean {
	const [service, child] = instancePath;
	if (scriptClass === "server")
		return SERVER_SCRIPT_SERVICES.includes(service);
	return (
		CLIENT_SCRIPT_SERVICES.includes(service) ||
		(service === "StarterPlayer" &&
			PLAYER_SCRIPT_CONTAINERS.includes(child))
	);
}

/** Where a route puts files: a service Rojo can write to, and the folders below it. */
export class Target {
	constructor(
		readonly service: SupportedService,
		readonly folders: readonly string[]
	) {}

	/** `location` is where the target was written, for the diagnostic. */
	static parse(
		text: string,
		location: DiagnosticLocation
	): Result<Target, Diagnostic[]> {
		const [service, ...folders] = text.split("/");
		if (!isSupportedService(service)) {
			const suggestion = Target.serviceFor(service);
			return err([
				errorDiagnostic(
					"roblox.unsupportedService",
					location,
					suggestion
						? `"${service}" is not a supported service. Did you mean "${[suggestion, ...folders].join("/")}"?`
						: `"${service}" is not a supported service; a target must start with a service Rojo can write to, such as ServerScriptService or ReplicatedStorage.`
				),
			]);
		}
		return ok(new Target(service, folders));
	}

	/** The service a misspelled one most likely meant; a player script container is reached through StarterPlayer. */
	private static serviceFor(name: string): string | undefined {
		const container = closestMatch(name, PLAYER_SCRIPT_CONTAINERS);
		if (container) return `StarterPlayer/${container}`;
		return closestMatch(name, SUPPORTED_SERVICES);
	}

	get instancePath(): readonly string[] {
		return [this.service, ...this.folders];
	}

	/** Whether the target is StarterPlayer's or the character's script container, where scripts run only with legacy run contexts. */
	get isPlayerScripts(): boolean {
		return (
			this.service === "StarterPlayer" &&
			PLAYER_SCRIPT_CONTAINERS.includes(this.folders[0])
		);
	}

	toString(): string {
		return this.instancePath.join("/");
	}
}

/** The class of a node Rogen creates to hold children: services and StarterPlayer's script containers keep their own, the rest are folders. */
export function containerClassName(instancePath: readonly string[]): string {
	const [service, child] = instancePath;
	if (instancePath.length === 1) return service;
	if (
		instancePath.length === 2 &&
		service === "StarterPlayer" &&
		PLAYER_SCRIPT_CONTAINERS.includes(child)
	)
		return child;
	return "Folder";
}

/** An instance named the way Studio prints it, `ServerScriptService.Inventory.Save`, or with slashes, the way Rogen does. */
export class InstanceReference {
	private static readonly GAME_PREFIX = /^game[./]/;
	private static readonly QUOTED = /'([^']+)'/;

	private constructor(
		/** The reference without `game.` or a line number. */
		readonly text: string,
		readonly separator: "." | "/"
	) {}

	/** Reads a pasted error line or stack frame: a quoted name is taken from its quotes, a leading `game.` and everything from the first `:` go. `undefined` unless it starts with a supported service. */
	static parse(input: string): InstanceReference | undefined {
		const quoted = InstanceReference.QUOTED.exec(input)?.[1] ?? input;
		const text = quoted
			.trim()
			.replace(InstanceReference.GAME_PREFIX, "")
			.split(":")[0]
			.replace(/[./]+$/, "");
		const separator = text.includes("/") ? "/" : ".";
		const [service] = text.split(separator);
		return isSupportedService(service)
			? new InstanceReference(text, separator)
			: undefined;
	}

	get service(): string {
		return this.text.split(this.separator)[0];
	}

	/** Whether `instancePath` is this instance or inside it. Names may hold the separator, so whole keys are compared rather than split segments. */
	contains(instancePath: readonly string[]): boolean {
		const key = instancePath.join(this.separator);
		return key === this.text || key.startsWith(this.text + this.separator);
	}
}
