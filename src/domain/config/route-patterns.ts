import { compareStrings } from "../../base/collections.js";
import { Target } from "../roblox/roblox.js";
import { DeclaredKeys } from "./declared-keys.js";

/** What the patterns of a config say about a file name: the route that takes it, or the patterns that tie with different targets. */
export type PatternMatch =
	| { readonly kind: "routed"; readonly key: string }
	| { readonly kind: "clash"; readonly keys: readonly string[] };

const PATTERN = /^[A-Za-z0-9._*-]+$/;

/** The route keys that are globs on a file's name, with `*` as their only wildcard. */
export class RoutePatterns {
	private readonly patterns: readonly {
		readonly key: string;
		readonly target: string;
		readonly weight: number;
		readonly regex: RegExp;
	}[];
	/** The name keys, each with its target, which a pattern's target is also reached by. */
	private readonly names: readonly (readonly [string, string])[];

	constructor(routes: ReadonlyMap<string, Target>) {
		this.names = [...routes]
			.filter(([key]) => DeclaredKeys.isName(key))
			.map(([key, target]) => [key, target.instancePath.join("/")]);
		this.patterns = [...routes]
			.filter(([key]) => RoutePatterns.isPattern(key))
			.map(([key, target]) => ({
				key,
				target: target.instancePath.join("/"),
				weight: key.replaceAll("*", "").length,
				regex: RoutePatterns.regexOf(key),
			}));
	}

	/** A key with a `*`, no `**`, and a letter or digit, written in the characters of a file name. */
	static isPattern(key: string): boolean {
		return (
			PATTERN.test(key) &&
			key.includes("*") &&
			!key.includes("**") &&
			/[A-Za-z0-9]/.test(key)
		);
	}

	get keys(): readonly string[] {
		return this.patterns.map(({ key }) => key);
	}

	/** The pattern with the most characters that aren't `*` among those matching one of `names`, a file's name and the name of the instance it makes; patterns of that weight with different targets clash. */
	match(...names: readonly string[]): PatternMatch | undefined {
		const matching = this.patterns.filter(({ regex }) =>
			names.some((name) => regex.test(name))
		);
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

	/** The first pattern that matches one of `names` only once letter case is ignored, which a file it misses was likely meant for. */
	matchIgnoringCase(...names: readonly string[]): string | undefined {
		if (this.match(...names)) return undefined;
		return this.patterns.find(({ key }) =>
			names.some((name) => RoutePatterns.regexOf(key, "i").test(name))
		)?.key;
	}

	/** The name key with the target of the pattern `key`, which routes a folder there, as no pattern does; none when no one name key has it. */
	nameKeyFor(key: string): string | undefined {
		const target = this.patterns.find((pattern) => pattern.key === key)
			?.target;
		const names = this.names.filter(([, to]) => to === target);
		return names.length === 1 ? names[0][0] : undefined;
	}

	private static regexOf(key: string, flags = ""): RegExp {
		const escaped = key
			.split("*")
			.map((part) => part.replace(/[.-]/g, "\\$&"))
			.join(".*");
		return new RegExp(`^${escaped}$`, flags);
	}
}
