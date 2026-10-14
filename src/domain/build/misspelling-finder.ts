import { editDistance, closestMatches } from "../../base/strings.js";
import { DeclaredKeys } from "../config/declared-keys.js";
import { RUN_SCRIPT_SUFFIXES } from "../rojo/rojo.js";

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

interface FolderTypo {
	readonly kind: "folderTypo";
	readonly text: string;
	readonly key: string;
	readonly respelling?: Respelling;
}

/** A name that looks like a slip in spelling a declared key. */
export type Misspelling = StrayAt | DotRoute | FolderTypo;

export type MisspellingKind = Misspelling["kind"];

export type MisspellingOf<K extends MisspellingKind> = Extract<
	Misspelling,
	{ readonly kind: K }
>;

/** Part of a name, written at `start`, and how to spell it instead. */
export interface Respelling {
	readonly start: number;
	readonly written: string;
	readonly spelling: string;
}

/** A misspelled name as the readings note it, with the path it's renamed to when one rename fixes it. */
export type NotedName<T> = T & { readonly renamedTo?: string };

const MIN_TYPO_KEY_LENGTH = 4;

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
		const key = this.dotRouteKey(text);
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
				: { start, written: `.${text}`, spelling: `@${key}` };
		return { kind: "dotRoute", text, key, respelling };
	}

	dotNameMisspelling(text: string): DotRoute | undefined {
		const route = this.dotRouteKey(text);
		return route ? MisspellingFinder.dotRouteOf(text, route, 0) : undefined;
	}

	folderTypo(name: string): FolderTypo | undefined {
		if (this.keys.resolve(name) !== undefined || this.keys.nearMiss(name))
			return undefined;
		const identity = DeclaredKeys.identityOf(name);
		const keys = [...this.keys.routeKeys].filter(
			(key) =>
				key.length >= MIN_TYPO_KEY_LENGTH &&
				editDistance(identity, DeclaredKeys.identityOf(key)) === 1
		);
		if (keys.length === 0) return undefined;
		const [key] = keys;
		const spelling =
			(name[0] === name[0].toUpperCase()
				? key[0].toUpperCase()
				: key[0].toLowerCase()) + key.slice(1);
		const respelling =
			keys.length === 1
				? { start: 0, written: name, spelling }
				: undefined;
		return {
			kind: "folderTypo",
			text: name,
			key,
			...(respelling && { respelling }),
		};
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
		const suggestion = `@${closest[0]}`;
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
