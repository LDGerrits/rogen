import { compareStrings } from "../../base/collections.js";
import { Target } from "../roblox/roblox.js";

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

	constructor(routes: ReadonlyMap<string, Target>) {
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

	/** The pattern with the most characters that aren't `*` among those matching `fileName`; patterns of that weight with different targets clash. */
	match(fileName: string): PatternMatch | undefined {
		const matching = this.patterns.filter(({ regex }) =>
			regex.test(fileName)
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

	private static regexOf(key: string): RegExp {
		const escaped = key
			.split("*")
			.map((part) => part.replace(/[.-]/g, "\\$&"))
			.join(".*");
		return new RegExp(`^${escaped}$`);
	}
}
