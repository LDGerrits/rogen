import { DeclaredKeys } from "../config/config.js";
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

export interface RouteOption {
	readonly id: RouteId;
	readonly key: string;
	readonly target: string;
	readonly hint: string;
	readonly ticked: boolean;
}

interface RouteTemplate {
	readonly id: StandardRouteId;
	/** The shared route's target is spelled like its key, so it has none here. */
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

/** The routes `init` offers to write, spelled the way `language` spells route keys. */
export class StartingRoutes {
	/** The standard routes that start ticked. */
	static readonly DEFAULT: readonly RouteId[] = ROUTES.filter(
		({ ticked }) => ticked
	).map(({ id }) => id);

	/** With `derived`, its routes come first and start ticked, and replace the standard route of the same key. */
	constructor(
		private readonly language: Language,
		private readonly derived?: DerivedRoutes
	) {}

	/** Where files that match no route go by default. */
	get sharedTarget(): string {
		return `ReplicatedStorage/${this.language.routeKey("shared")}`;
	}

	/** Where files that match no route go: where the project file mounted the root dir, or its shared code, else the standard place. */
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

	/** The routes that start ticked. */
	get tickedByDefault(): RouteId[] {
		return this.options.filter(({ ticked }) => ticked).map(({ id }) => id);
	}

	/** With no route ticked the fallback is written anyway, because a config with no routes can't build. */
	starting(
		ticked: readonly RouteId[],
		fallback: boolean
	): Record<string, string> {
		const routes = this.options.filter(({ id }) => ticked.includes(id));
		return {
			...Object.fromEntries(
				routes.map(({ key, target }) => [key, target])
			),
			...((fallback || routes.length === 0) && {
				[DeclaredKeys.FALLBACK_ROUTE]: this.fallbackTarget,
			}),
		};
	}
}
