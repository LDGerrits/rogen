import { compareStrings } from "../../base/collections.js";
import { isGlobsetMatch } from "../../base/glob.js";
import { Target } from "../roblox/roblox.js";
import { DeclaredKeys } from "./declared-keys.js";

/** What the patterns of a config say about a file name: the route that takes it, or the patterns that tie with different targets. */
export type PatternMatch =
	| { readonly kind: "routed"; readonly key: string }
	| { readonly kind: "clash"; readonly keys: readonly string[] };

/** A route key read as one of Rojo's globs on a single name: `*`, `?`, a `[...]` class and `{a,b}` alternatives, with no path. */
interface Glob {
	/** The key with each choice of its `{a,b}` groups made, as globs without braces. */
	readonly alternatives: readonly string[];
}

const LITERAL = /[A-Za-z0-9._-]/;
const CLASS_BODY = /^[!^]?[A-Za-z0-9._-]+$/;
const WILDCARD = /[*?[{]/;

/** The route keys that are Rojo globs on a file's name. */
export class RoutePatterns {
	private readonly patterns: readonly {
		readonly key: string;
		readonly target: string;
		/** Each alternative of the key, with the characters it matches that aren't `*`. */
		readonly alternatives: readonly {
			readonly glob: string;
			readonly weight: number;
		}[];
	}[];
	/** The name keys, each with its target, which a pattern's target is also reached by. */
	private readonly names: readonly (readonly [string, string])[];

	constructor(routes: ReadonlyMap<string, Target>) {
		this.names = [...routes]
			.filter(([key]) => DeclaredKeys.isName(key))
			.map(([key, target]) => [key, target.instancePath.join("/")]);
		this.patterns = [...routes].flatMap(([key, target]) => {
			const glob = RoutePatterns.parse(key);
			return glob
				? [
						{
							key,
							target: target.instancePath.join("/"),
							alternatives: glob.alternatives.map((one) => ({
								glob: one,
								weight: RoutePatterns.weightOf(one),
							})),
						},
					]
				: [];
		});
	}

	/** A key with a wildcard and a letter or digit, written in the characters of a file name and Rojo's glob syntax for one name: no `/` or `**`, closed classes and `{a,b}` groups, none nested. */
	static isPattern(key: string): boolean {
		return RoutePatterns.parse(key) !== undefined;
	}

	get keys(): readonly string[] {
		return this.patterns.map(({ key }) => key);
	}

	/** The pattern whose matching alternative has the most characters that aren't `*` (`?` and a class count one each), among those matching one of `names`, a file's name and the name of the instance it makes; patterns of that weight with different targets clash. */
	match(...names: readonly string[]): PatternMatch | undefined {
		const matching = this.patterns.flatMap((pattern) => {
			const weights = pattern.alternatives
				.filter(({ glob }) =>
					names.some((name) => isGlobsetMatch(name, glob))
				)
				.map(({ weight }) => weight);
			return weights.length > 0
				? [{ ...pattern, weight: Math.max(...weights) }]
				: [];
		});
		if (matching.length === 0) return undefined;
		const weight = Math.max(...matching.map((pattern) => pattern.weight));
		const best = matching.filter((pattern) => pattern.weight === weight);
		if (new Set(best.map(({ target }) => target)).size === 1)
			return { kind: "routed", key: best[0].key };
		return {
			kind: "clash",
			keys: best.map(({ key }) => key).sort(compareStrings),
		};
	}

	/** The name key with the target of the pattern `key`, which routes a folder there, as no pattern does; none when no one name key has it. */
	nameKeyFor(key: string): string | undefined {
		const target = this.patterns.find(
			(pattern) => pattern.key === key
		)?.target;
		const names = this.names.filter(([, to]) => to === target);
		return names.length === 1 ? names[0][0] : undefined;
	}

	/** `key` as a glob on one name, or none when it isn't one. */
	private static parse(key: string): Glob | undefined {
		if (
			!WILDCARD.test(key) ||
			!/[A-Za-z0-9]/.test(key) ||
			key.includes("**")
		)
			return undefined;
		let alternatives = [""];
		for (let at = 0; at < key.length; at++) {
			const char = key[at];
			if (char === "[") {
				const close = key.indexOf("]", at + 1);
				if (close < 0 || !CLASS_BODY.test(key.slice(at + 1, close)))
					return undefined;
				const part = key.slice(at, close + 1);
				alternatives = alternatives.map((one) => one + part);
				at = close;
			} else if (char === "{") {
				const close = key.indexOf("}", at + 1);
				if (close < 0) return undefined;
				const choices = key.slice(at + 1, close).split(",");
				if (
					choices.some(
						(choice) => !/^[A-Za-z0-9._*?-]*$/.test(choice)
					)
				)
					return undefined;
				alternatives = alternatives.flatMap((one) =>
					choices.map((choice) => one + choice)
				);
				at = close;
			} else if (char === "*" || char === "?" || LITERAL.test(char))
				alternatives = alternatives.map((one) => one + char);
			else return undefined;
		}
		if (alternatives.some((one) => one.includes("**"))) return undefined;
		return { alternatives: [...new Set(alternatives)] };
	}

	/** The characters `glob` matches that aren't `*`: a literal, a `?` or a class each count one. */
	private static weightOf(glob: string): number {
		let weight = 0;
		for (let at = 0; at < glob.length; at++) {
			if (glob[at] === "*") continue;
			if (glob[at] === "[") at = glob.indexOf("]", at + 1);
			weight++;
		}
		return weight;
	}
}
