import { DeclaredKeys } from "../config/declared-keys.js";
import { Language } from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";

type StandardRouteId = "server" | "client" | "shared";

/** The routes a new config starts with; shared code goes to a folder named like its key. */
const ROUTES: readonly { id: StandardRouteId; target?: string }[] = [
	{ id: "server", target: "ServerScriptService" },
	{ id: "client", target: "StarterPlayer/StarterPlayerScripts" },
	{ id: "shared" },
];

/** The keys of the routes every new config starts with, in lower case. */
export const STANDARD_ROUTE_IDS: readonly string[] = ROUTES.map(({ id }) => id);

export class StartingRoutes {
	/** With `derived`, its routes come first and replace the standard route of the same key. `spellings` maps a standard key, lower-cased, to how the code already spells it. */
	constructor(
		private readonly language: Language,
		private readonly derived?: DerivedRoutes,
		private readonly spellings: ReadonlyMap<string, string> = new Map()
	) {}

	/** Whether a folder of this name is read as a key of the routes a config starts with, which `derived` adds to. */
	static isKey(name: string, derived?: DerivedRoutes): boolean {
		const identity = DeclaredKeys.identityOf(name);
		return [
			...ROUTES.map(({ id }) => id),
			...(derived?.routes.keys() ?? []),
		].some((key) => DeclaredKeys.identityOf(key) === identity);
	}

	get sharedTarget(): string {
		return `ReplicatedStorage/${this.language.routeKey("shared")}`;
	}

	get fallbackTarget(): string {
		return this.derived?.fallback ?? this.sharedTarget;
	}

	/** How a standard key is spelled: as the code spells it, else in the casing of the derived keys, else the language's. Keys match names exactly. */
	private standardKey(id: StandardRouteId): string {
		const spelled = this.spellings.get(id);
		if (spelled !== undefined) return spelled;
		const derived = [...(this.derived?.routes.keys() ?? [])];
		if (derived.length === 0) return this.language.routeKey(id);
		const lower = derived.filter((key) => key[0] === key[0].toLowerCase());
		return lower.length * 2 >= derived.length
			? id
			: id[0].toUpperCase() + id.slice(1);
	}

	/** The derived routes, the standard ones whose keys they leave free, and `*`. */
	get routes(): Record<string, string> {
		const derived = [...(this.derived?.routes ?? [])];
		const taken = new Set(
			derived.map(([key]) => DeclaredKeys.identityOf(key))
		);
		const standard = ROUTES.map(
			({ id, target }) =>
				[this.standardKey(id), target ?? this.sharedTarget] as const
		).filter(([key]) => !taken.has(DeclaredKeys.identityOf(key)));
		return {
			...Object.fromEntries([...derived, ...standard]),
			[DeclaredKeys.FALLBACK_ROUTE]: this.fallbackTarget,
		};
	}
}
