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

const SERVER_ONLY_SERVICES: readonly string[] = [
	"ServerScriptService",
	"ServerStorage",
];

export function isServerOnlyService(service: string): boolean {
	return SERVER_ONLY_SERVICES.includes(service);
}

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

const SCRIPT_STORAGE_SERVICE = "ServerStorage";

export const WHERE_SCRIPTS_RUN = `A Script runs in ${joinedWithOr(SERVER_SCRIPT_SERVICES)}, and a LocalScript in ${joinedWithOr([...PLAYER_SCRIPT_CONTAINERS, ...CLIENT_SCRIPT_SERVICES])}. A Script with RunContext Client never runs in ${joinedWithOr(SERVER_ONLY_SERVICES.filter((service) => service !== SCRIPT_STORAGE_SERVICE))}, which clients can't see.`;

export function scriptFate(
	run: ScriptRun,
	instancePath: readonly string[]
): "runs" | "stored" | "neverRuns" {
	if (scriptRunsAt(run, instancePath)) return "runs";
	return instancePath[0] === SCRIPT_STORAGE_SERVICE ? "stored" : "neverRuns";
}

export function isPlayerScriptContainer(
	instancePath: readonly string[]
): boolean {
	const [service, child] = instancePath;
	return (
		service === "StarterPlayer" && PLAYER_SCRIPT_CONTAINERS.includes(child)
	);
}

function scriptRunsAt(
	run: ScriptRun,
	instancePath: readonly string[]
): boolean {
	const [service] = instancePath;
	switch (run) {
		case "Script":
			return SERVER_SCRIPT_SERVICES.includes(service);
		case "LocalScript":
			return (
				CLIENT_SCRIPT_SERVICES.includes(service) ||
				isPlayerScriptContainer(instancePath)
			);
		case "Server":
			return service !== SCRIPT_STORAGE_SERVICE;
		case "Client":
			return !isServerOnlyService(service);
		case "Plugin":
			return true;
	}
}

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
		const unnamed = folders.find(
			(folder) => folder === "" || folder === "." || folder === ".."
		);
		if (unnamed !== undefined) {
			return err([
				errorDiagnostic(
					"roblox.invalidFolder",
					location,
					`the target "${text}" has ${unnamed === "" ? "an empty folder name" : `"${unnamed}" as a folder name`}; write each folder between single slashes, such as "${service}/Folder".`
				),
			]);
		}
		return ok(new Target(service, folders));
	}

	private static serviceFor(name: string): string | undefined {
		const container = closestMatch(name, PLAYER_SCRIPT_CONTAINERS);
		if (container) return `StarterPlayer/${container}`;
		return closestMatch(name, SUPPORTED_SERVICES);
	}

	get instancePath(): readonly string[] {
		return [this.service, ...this.folders];
	}

	get isPlayerScripts(): boolean {
		return isPlayerScriptContainer(this.instancePath);
	}

	toString(): string {
		return instanceKey(this.instancePath);
	}
}

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

/** Why a path under a runtime-cloned container can't be required, or `undefined` elsewhere. */
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

/** The Luau expression that reaches `instancePath`, or `undefined` under a runtime-cloned container. */
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
	if (instancePath.length === 1) return instancePath[0];
	if (instancePath.length === 2 && isPlayerScriptContainer(instancePath))
		return instancePath[1];
	return "Folder";
}

/** An instance named the way Studio prints it, `ServerScriptService.Inventory.Save`, or with slashes, the way Rogen does. */
export class InstanceReference {
	private static readonly GAME_PREFIX = /^game[./]/;
	private static readonly QUOTED = /'([^']+)'/;
	private static readonly COLON_LINE = /^[^:]*:\d+/;
	private static readonly LINE_AFTER_QUOTE = /^[\s,(]*line\s+\d+/i;

	private constructor(
		/** The reference without `game.` or a line number. */
		readonly text: string,
		readonly separator: "." | "/",
		/** Whether a line number came with it, which only a script has: what is inside the instance is not asked about. */
		readonly namesScript = false
	) {}

	/** Reads a pasted error line or stack frame; `undefined` unless it starts with a supported service. */
	static parse(input: string): InstanceReference | undefined {
		const quote = InstanceReference.QUOTED.exec(input);
		const unquoted = input
			.trim()
			.replace(InstanceReference.GAME_PREFIX, "");
		const text = (quote?.[1] ?? input)
			.trim()
			.replace(InstanceReference.GAME_PREFIX, "")
			.split(":")[0]
			.replace(/[./]+$/, "");
		const separator = text.includes("/") ? "/" : ".";
		const [service] = text.split(separator);
		return isSupportedService(service)
			? new InstanceReference(
					text,
					separator,
					quote
						? InstanceReference.LINE_AFTER_QUOTE.test(
								input.slice(quote.index + quote[0].length)
							)
						: InstanceReference.COLON_LINE.test(unquoted)
				)
			: undefined;
	}

	get service(): string {
		return this.text.split(this.separator)[0];
	}

	/** Whether `instancePath` is this instance, or inside it unless a line number says it is a script. */
	contains(instancePath: readonly string[]): boolean {
		const key = instancePath.join(this.separator);
		return (
			key === this.text ||
			(!this.namesScript && key.startsWith(this.text + this.separator))
		);
	}
}

const INSTANCE_SEPARATOR = "/";

export function instanceKey(instancePath: readonly string[]): string {
	return instancePath.join(INSTANCE_SEPARATOR);
}

/** A map keyed by instance path, kept in the order paths were first set. */
export class InstanceMap<V> implements Iterable<[readonly string[], V]> {
	private readonly entries = new Map<
		string,
		{ readonly path: readonly string[]; value: V }
	>();

	get(instancePath: readonly string[]): V | undefined {
		return this.entries.get(instanceKey(instancePath))?.value;
	}

	set(instancePath: readonly string[], value: V): this {
		const key = instanceKey(instancePath);
		const existing = this.entries.get(key);
		if (existing) existing.value = value;
		else this.entries.set(key, { path: instancePath, value });
		return this;
	}

	*values(): IterableIterator<V> {
		for (const { value } of this.entries.values()) yield value;
	}

	*[Symbol.iterator](): IterableIterator<[readonly string[], V]> {
		for (const { path, value } of this.entries.values())
			yield [path, value];
	}
}
