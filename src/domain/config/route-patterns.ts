import { compareByCodePoint } from "../../base/collections.js";
import { isGlobsetMatch } from "../../base/glob.js";
import { Target } from "../roblox/roblox.js";
import { DeclaredKeys } from "./declared-keys.js";

export type PatternMatch =
	| { readonly kind: "routed"; readonly key: string }
	| { readonly kind: "clash"; readonly keys: readonly string[] };

interface Glob {
	readonly alternatives: readonly string[];
}

const LITERAL = /[A-Za-z0-9._-]/;
const CLASS_BODY = /^[!^]?[A-Za-z0-9._-]+$/;
const WILDCARD = /[*?[{]/;
const CHOICE = /^(?:[A-Za-z0-9._*?-]|\[[!^]?[A-Za-z0-9._-]+\])*$/;

export class RoutePatterns {
	private readonly patterns: readonly {
		readonly key: string;
		readonly target: string;
		readonly alternatives: readonly {
			readonly glob: string;
			readonly weight: number;
		}[];
	}[];
	private readonly targets: ReadonlyMap<string, string>;
	private readonly names: readonly (readonly [string, string])[];

	constructor(routes: ReadonlyMap<string, Target>) {
		this.targets = new Map(
			[...routes].map(([key, target]) => [
				key,
				target.instancePath.join("/"),
			])
		);
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

	static isPattern(key: string): boolean {
		return RoutePatterns.parse(key) !== undefined;
	}

	get keys(): readonly string[] {
		return this.patterns.map(({ key }) => key);
	}

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
			keys: best.map(({ key }) => key).sort(compareByCodePoint),
		};
	}

	nameKeyFor(key: string): string | undefined {
		const target = this.targets.get(key);
		if (target === undefined) return undefined;
		const names = this.names.filter(([, to]) => to === target);
		return names.length === 1 ? names[0][0] : undefined;
	}

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
				if (choices.some((choice) => !CHOICE.test(choice)))
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
