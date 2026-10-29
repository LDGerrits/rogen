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

export class StartingRoutes {
	/** With `derived`, its routes come first and replace the standard route of the same key. */
	constructor(
		private readonly language: Language,
		private readonly derived?: DerivedRoutes
	) {}

	get sharedTarget(): string {
		return `ReplicatedStorage/${this.language.routeKey("shared")}`;
	}

	get fallbackTarget(): string {
		return this.derived?.fallback ?? this.sharedTarget;
	}

	/** The key a derived route is written with: the language's casing, so one lift doesn't mix `shared` and `Server`. A language that keeps ids as they are (roblox-ts) keeps the folder's spelling, unless a standard route has the key. */
	private keyOf(derivedKey: string): string {
		const identity = DeclaredKeys.identityOf(derivedKey);
		const standard = ROUTES.map(({ id }) =>
			this.language.routeKey(id)
		).find((key) => DeclaredKeys.identityOf(key) === identity);
		if (standard) return standard;
		const cased = this.language.routeKey(identity);
		return cased === identity ? derivedKey : cased;
	}

	/** The derived routes, the standard ones whose keys they leave free, and `*`. */
	get routes(): Record<string, string> {
		const derived = [...(this.derived?.routes ?? [])].map(
			([key, target]) => [this.keyOf(key), target] as const
		);
		const taken = new Set(
			derived.map(([key]) => DeclaredKeys.identityOf(key))
		);
		const standard = ROUTES.map(
			({ id, target }) =>
				[
					this.language.routeKey(id),
					target ?? this.sharedTarget,
				] as const
		).filter(([key]) => !taken.has(DeclaredKeys.identityOf(key)));
		return {
			...Object.fromEntries([...derived, ...standard]),
			[DeclaredKeys.FALLBACK_ROUTE]: this.fallbackTarget,
		};
	}
}
