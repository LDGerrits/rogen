import { DeclaredKeys } from "../config/declared-keys.js";
import { Language } from "../toolchain/toolchain.js";
import { DerivedRoutes } from "./derived-routes.js";

type StandardRouteId =
	| "server"
	| "client"
	| "shared"
	| "replicatedFirst"
	| "serverStorage"
	| "starterGui";

/** A standard route, or one derived from a mount, named `mount:<key>`. */
export type RouteId = StandardRouteId | `mount:${string}`;

interface RouteOption {
	readonly id: RouteId;
	readonly key: string;
	readonly target: string;
	readonly hint: string;
	readonly ticked: boolean;
}

interface RouteTemplate {
	readonly id: StandardRouteId;
	readonly target?: string;
	readonly hint: string;
	readonly ticked: boolean;
}

const ROUTES: readonly RouteTemplate[] = [
	{
		id: "server",
		target: "ServerScriptService",
		hint: "runs on the server",
		ticked: true,
	},
	{
		id: "client",
		target: "StarterPlayer/StarterPlayerScripts",
		hint: "runs on each player's client",
		ticked: true,
	},
	{ id: "shared", hint: "modules both sides require", ticked: true },
	{
		id: "replicatedFirst",
		target: "ReplicatedFirst",
		hint: "runs first on the client, while loading",
		ticked: false,
	},
	{
		id: "serverStorage",
		target: "ServerStorage",
		hint: "server modules that don't run on their own",
		ticked: false,
	},
	{
		id: "starterGui",
		target: "StarterGui",
		hint: "UI copied to each player",
		ticked: false,
	},
];

export class StartingRoutes {
	/** With `derived`, its routes come first, start ticked, and replace the standard route of the same key. */
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

	get options(): RouteOption[] {
		const derived = [...(this.derived?.routes ?? [])].map(
			([key, target]): RouteOption => ({
				id: `mount:${key}`,
				key,
				target,
				hint: `from ${this.derived?.from}`,
				ticked: true,
			})
		);
		const taken = new Set(
			derived.map(({ key }) => DeclaredKeys.identityOf(key))
		);
		const standard = ROUTES.map(
			({ id, target, hint, ticked }): RouteOption => ({
				id,
				key: this.language.routeKey(id),
				target: target ?? this.sharedTarget,
				hint,
				ticked,
			})
		).filter(({ key }) => !taken.has(DeclaredKeys.identityOf(key)));
		return [...derived, ...standard];
	}

	get tickedByDefault(): RouteId[] {
		return this.options.filter(({ ticked }) => ticked).map(({ id }) => id);
	}

	starting(
		ticked: readonly RouteId[],
		alwaysWriteFallback: boolean
	): Record<string, string> {
		const routes = this.options.filter(({ id }) => ticked.includes(id));
		return {
			...Object.fromEntries(
				routes.map(({ key, target }) => [key, target])
			),
			...((alwaysWriteFallback || routes.length === 0) && {
				[DeclaredKeys.FALLBACK_ROUTE]: this.fallbackTarget,
			}),
		};
	}
}
