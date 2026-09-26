import { Language } from "./detect-workspace.js";

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

export const DEFAULT_ROUTES: readonly RouteId[] = ROUTES.filter(
	({ ticked }) => ticked
).map(({ id }) => id);

/** Luau keys start with a capital, roblox-ts keys with a lowercase letter. */
export const routeKey = (id: RouteId, language: Language): string =>
	language === "luau" ? `${id[0].toUpperCase()}${id.slice(1)}` : id;

export const sharedTarget = (language: Language): string =>
	`ReplicatedStorage/${routeKey("shared", language)}`;

export const routeOptions = (language: Language): RouteOption[] =>
	ROUTES.map(({ id, target, hint, ticked }) => ({
		id,
		key: routeKey(id, language),
		target: target ?? sharedTarget(language),
		hint,
		ticked,
	}));

/** With no route ticked the fallback is written anyway, because a config with no routes can't build. */
export function startingRoutes(
	language: Language,
	ticked: readonly RouteId[],
	fallback: boolean
): Record<string, string> {
	const routes = routeOptions(language).filter(({ id }) =>
		ticked.includes(id)
	);
	return {
		...Object.fromEntries(routes.map(({ key, target }) => [key, target])),
		...((fallback || routes.length === 0) && {
			"*": sharedTarget(language),
		}),
	};
}
