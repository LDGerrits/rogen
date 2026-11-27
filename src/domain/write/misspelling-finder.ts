import { closestMatches } from "../../base/strings.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { RUN_SCRIPT_SUFFIXES } from "../rojo/rojo.js";
import { routeMarkOf } from "./write.js";

interface StrayAt {
	readonly kind: "strayAt";
	readonly text: string;
	readonly suggestion: string;
	readonly notLast: boolean;
	readonly respelling?: Respelling;
}

interface DotRoute {
	readonly kind: "dotRoute";
	readonly text: string;
	readonly key: string;
	readonly respelling: Respelling;
}

export type Misspelling = StrayAt | DotRoute;

export type MisspellingKind = Misspelling["kind"];

export type MisspellingOf<K extends MisspellingKind> = Extract<
	Misspelling,
	{ readonly kind: K }
>;

export interface Respelling {
	readonly start: number;
	readonly written: string;
	readonly spelling: string;
}

export type NotedName<T> = T & { readonly renamedTo?: string };

export class MisspellingFinder {
	constructor(private readonly keys: DeclaredKeys) {}

	dotRoute(
		remaining: string,
		script: boolean,
		stem: string
	): DotRoute | undefined {
		const dot = remaining.lastIndexOf(".");
		if (dot <= 0 || dot < remaining.lastIndexOf("@")) return undefined;
		const text = remaining.slice(dot + 1);
		const rojo = text.toLowerCase();
		const key = RUN_SCRIPT_SUFFIXES.has(rojo)
			? this.keys.resolveDotRoute(rojo)
			: undefined;
		return key
			? MisspellingFinder.dotRouteOf(
					text,
					key,
					dot,
					script ? stem : undefined
				)
			: undefined;
	}

	private dotRouteKey(text: string): string | undefined {
		return this.keys.resolve(text) ?? this.keys.nearMiss(text);
	}

	private static dotRouteOf(
		text: string,
		key: string,
		start: number,
		stem?: string
	): DotRoute {
		const rojo = text.toLowerCase();
		const after = stem?.slice(start + text.length + 1) ?? "";
		const respelling =
			stem !== undefined && RUN_SCRIPT_SUFFIXES.has(rojo)
				? {
						start,
						written: `.${text}${after}`,
						spelling: `${after}.${rojo}`,
					}
				: { start, written: `.${text}`, spelling: routeMarkOf(key) };
		return { kind: "dotRoute", text, key, respelling };
	}

	dotNameMisspelling(text: string): DotRoute | undefined {
		const route = this.dotRouteKey(text);
		return route ? MisspellingFinder.dotRouteOf(text, route, 0) : undefined;
	}

	strayAt(name: string): StrayAt | undefined {
		const at = name.lastIndexOf("@");
		if (at < 0) return undefined;
		const text = name.slice(at + 1).split(".")[0];
		if (text === "") return undefined;
		const written = `@${text}`;
		const closest = closestMatches(text, this.keys.routeKeys);
		const notLast = this.keys.resolve(text) !== undefined;
		if (closest.length === 0 || (at === 0 && notLast)) return undefined;
		const suggestion = routeMarkOf(closest[0]);
		return {
			kind: "strayAt",
			text,
			suggestion,
			notLast,
			...(closest.length === 1 &&
				!notLast && {
					respelling: { start: at, written, spelling: suggestion },
				}),
		};
	}
}
