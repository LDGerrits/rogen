import { editDistance, closestMatches } from "../../base/strings.js";
import { DeclaredKeys } from "../config/config.js";
import { RUN_SCRIPT_SUFFIXES } from "../rojo/rojo.js";

/** An `@` followed by a near miss of a declared route, or by a route that isn't at the end of the name. */
export interface StrayAt {
	readonly kind: "strayAt";
	/** The name after the `@`, up to the next dot. */
	readonly text: string;
	/** What to write instead: the closest route key's `@` form. */
	readonly suggestion: string;
	/** `text` is a declared route, but dot parts follow it, so it isn't at the end of the name. */
	readonly notLast: boolean;
	/** The one rename that fixes it: none when another key is as close, or `notLast`. */
	readonly respelling?: Respelling;
}

/** A declared route key after a dot, where only `@` routes: a dot-file, or a dot part of a name. */
export interface DotRoute {
	readonly kind: "dotRoute";
	readonly text: string;
	readonly key: string;
	readonly respelling: Respelling;
}

/** A folder whose whole name is one edit from a declared route key. */
export interface FolderTypo {
	readonly kind: "folderTypo";
	/** The folder's name with its parentheses and `^` off. */
	readonly text: string;
	readonly key: string;
	/** The one rename that fixes it: none when another key is as close. */
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

/** Shorter keys are one edit from real words, so a folder is not read as a slip of them. */
const MIN_TYPO_KEY_LENGTH = 4;

/** Finds the names that look like a slip in spelling one of the config's declared keys. */
export class MisspellingFinder {
	constructor(private readonly keys: DeclaredKeys) {}

	/** Only `@` routes, and Rojo's `.server`/`.client` on a script, which `suffixes` already took. */
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

	/** The route a dot part spells in any letter case: the dot is already the slip, so the case is fixed with it. */
	private dotRouteKey(text: string): string | undefined {
		return this.keys.resolve(text) ?? this.keys.nearMiss(text);
	}

	/** `.text` at `start`, which spells the route `key`, respelt with its `@`. In a script's `stem`, Rojo's own suffix is respelt as Rojo reads it: lower case, and last. */
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

	/** A dot-file or dot-folder `.text` that spells a route key, which only `@` routes. */
	dotNameMisspelling(text: string): DotRoute | undefined {
		const route = this.dotRouteKey(text);
		return route ? MisspellingFinder.dotRouteOf(text, route, 0) : undefined;
	}

	/** A folder named one edit from a declared route key, which would route if it were spelt right. A key shorter than four letters is not offered, since it is one edit from real words. */
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
		// The name's own first letter, so the rename keeps its case.
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
		// Package names use `@` too (`@rbxts`, `owner_name@1.5.1`), so only a near miss of a route is a typo.
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
