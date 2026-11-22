import { DeclaredKeys } from "../config/declared-keys.js";
import { Language } from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";

type StandardRouteId = "server" | "client" | "shared";

const ROUTES: readonly { id: StandardRouteId; target?: string }[] = [
	{ id: "server", target: "ServerScriptService" },
	{ id: "client", target: "StarterPlayer/StarterPlayerScripts" },
	{ id: "shared" },
];

export const STANDARD_ROUTE_IDS: readonly string[] = ROUTES.map(({ id }) => id);

type KeyCase = "lower" | "upper";

const caseOf = (key: string): KeyCase =>
	key[0] === key[0].toLowerCase() ? "lower" : "upper";

const inCase = (keyCase: KeyCase, id: StandardRouteId): string =>
	keyCase === "lower" ? id : id[0].toUpperCase() + id.slice(1);

export class StartingRoutes {
	constructor(
		private readonly language: Language,
		private readonly derived?: DerivedRoutes,
		private readonly spellings: ReadonlyMap<string, string> = new Map()
	) {}

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

	private standardKey(id: StandardRouteId): string {
		const spelled = this.spellings.get(id);
		if (spelled !== undefined) return spelled;
		const derived = [...(this.derived?.routes.keys() ?? [])];
		if (this.spellings.size > 0) {
			const cases = new Set(
				[...this.spellings.values(), ...derived].map(caseOf)
			);
			return cases.size === 1
				? inCase([...cases][0], id)
				: this.language.routeKey(id);
		}
		if (derived.length === 0) return this.language.routeKey(id);
		const lower = derived.filter((key) => caseOf(key) === "lower");
		return inCase(
			lower.length * 2 >= derived.length ? "lower" : "upper",
			id
		);
	}

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
