import { DeclaredKeys } from "../config/config.js";
import { Language } from "../toolchain/toolchain.js";

export type RouteId =
	| "server"
	| "client"
	| "shared"
	| "replicatedFirst"
	| "serverStorage"
	| "starterGui";

export interface RouteOption {
	readonly id: RouteId;
	readonly key: string;
	readonly target: string;
	readonly hint: string;
	readonly ticked: boolean;
}

interface RouteTemplate {
	readonly id: RouteId;
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
	/** The routes that start ticked. */
	static readonly DEFAULT: readonly RouteId[] = ROUTES.filter(
		({ ticked }) => ticked
	).map(({ id }) => id);

	constructor(private readonly language: Language) {}

	/** Where files that match no route go. */
	get sharedTarget(): string {
		return `ReplicatedStorage/${this.language.routeKey("shared")}`;
	}

	get options(): RouteOption[] {
		return ROUTES.map(({ id, target, hint, ticked }) => ({
			id,
			key: this.language.routeKey(id),
			target: target ?? this.sharedTarget,
			hint,
			ticked,
		}));
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
				[DeclaredKeys.FALLBACK_ROUTE]: this.sharedTarget,
			}),
		};
	}
}
