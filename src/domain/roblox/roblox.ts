import { Result, err, ok } from "../../base/result.js";
import { closestMatch, joinedWithOr } from "../../base/strings.js";
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

/** How a script runs: a legacy `Script` or a `LocalScript` by its class, any other `Script` by its `RunContext`. */
export type ScriptRun =
	"Script" | "LocalScript" | "Server" | "Client" | "Plugin";

/** Where scripts are kept for code to clone out, so a script there that never runs isn't a mistake. */
const SCRIPT_STORAGE_SERVICE = "ServerStorage";

/** Where each kind of script runs, as a sentence for a warning about one that doesn't. */
export const WHERE_SCRIPTS_RUN = `A Script runs in ${joinedWithOr(SERVER_SCRIPT_SERVICES)}, and a LocalScript in ${joinedWithOr([...PLAYER_SCRIPT_CONTAINERS, ...CLIENT_SCRIPT_SERVICES])}. A Script with RunContext Client never runs in ${joinedWithOr(SERVER_ONLY_SERVICES.filter((service) => service !== SCRIPT_STORAGE_SERVICE))}, which clients can't see.`;

/** What becomes of a script that runs as `run` at `instancePath`: it runs, it is stored for code to clone out, or it never runs. */
export function scriptFate(
	run: ScriptRun,
	instancePath: readonly string[]
): "runs" | "stored" | "neverRuns" {
	if (scriptRunsAt(run, instancePath)) return "runs";
	return instancePath[0] === SCRIPT_STORAGE_SERVICE ? "stored" : "neverRuns";
}

/** Whether a script that runs as `run` ever runs at `instancePath`, as Roblox documents it; no script runs from ServerStorage. */
function scriptRunsAt(
	run: ScriptRun,
	instancePath: readonly string[]
): boolean {
	const [service, child] = instancePath;
	switch (run) {
		case "Script":
			return SERVER_SCRIPT_SERVICES.includes(service);
		case "LocalScript":
			return (
				CLIENT_SCRIPT_SERVICES.includes(service) ||
				(service === "StarterPlayer" &&
					PLAYER_SCRIPT_CONTAINERS.includes(child))
			);
		case "Server":
			return service !== SCRIPT_STORAGE_SERVICE;
		case "Client":
			// Clients never receive what is in a server-only service.
			return !isServerOnlyService(service);
		case "Plugin":
			return true;
	}
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

/** Luau's reserved words, which can't be written after a dot. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
	"and",
	"break",
	"do",
	"else",
	"elseif",
	"end",
	"false",
	"for",
	"function",
	"if",
	"in",
	"local",
	"nil",
	"not",
	"or",
	"repeat",
	"return",
	"then",
	"true",
	"until",
	"while",
]);

/** The containers whose contents Roblox clones into the player or character at runtime, so their edit-time path is not where the code that runs finds them. */
const CLONED_AT_RUNTIME: readonly {
	readonly container: readonly string[];
	readonly into: string;
}[] = [
	{
		container: ["StarterPlayer", "StarterPlayerScripts"],
		into: "each player",
	},
	{
		container: ["StarterPlayer", "StarterCharacterScripts"],
		into: "each character",
	},
	{ container: ["StarterGui"], into: "each player" },
	{ container: ["StarterPack"], into: "each player" },
];

/** Why nothing under a container that is cloned at runtime can be reached by its path, such as `StarterPlayerScripts is cloned into each player`; `undefined` anywhere else. */
export function whyNotRequirable(
	instancePath: readonly string[]
): string | undefined {
	const cloned = CLONED_AT_RUNTIME.find(({ container }) =>
		container.every((name, index) => instancePath[index] === name)
	);
	return (
		cloned &&
		`${cloned.container[cloned.container.length - 1]} is cloned into ${cloned.into}`
	);
}

/** The Luau expression that reaches the instance at `instancePath`, as `game:GetService("ReplicatedStorage").Shared.Types`, with `["Foo Bar"]` for a name that isn't an identifier or is reserved. `undefined` under the containers cloned at runtime, where that path names the template and not the copy. */
export function requireExpression(
	instancePath: readonly string[]
): string | undefined {
	const [service, ...names] = instancePath;
	if (service === undefined || whyNotRequirable(instancePath) !== undefined)
		return undefined;
	return [
		`game:GetService("${service}")`,
		...names.map((name) =>
			/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED_WORDS.has(name)
				? `.${name}`
				: `[${JSON.stringify(name)}]`
		),
	].join("");
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
