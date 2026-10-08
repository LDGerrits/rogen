/** What decides that a variant is on. */
export type SwitchCause = "mode" | "cli";

/** Whether a variant is on, and what turned it on. */
export interface VariantSwitch {
	readonly on: boolean;
	readonly by?: SwitchCause;
}

/**
 * Each declared variant's switch: on when the mode lists it or the command
 * line adds it, and off when the command line removes it, which applies last.
 */
export function switchVariants(
	declared: readonly string[],
	listed: readonly string[],
	cli: Readonly<Record<string, boolean>>
): Map<string, VariantSwitch> {
	const byMode = new Set(listed);
	return new Map(
		declared.map((variant): [string, VariantSwitch] => {
			if (cli[variant] === false) return [variant, { on: false }];
			if (byMode.has(variant)) return [variant, { on: true, by: "mode" }];
			return cli[variant] === true
				? [variant, { on: true, by: "cli" }]
				: [variant, { on: false }];
		})
	);
}

/** Variant name to whether it is on. */
export function variantStates(
	switches: ReadonlyMap<string, VariantSwitch>
): Record<string, boolean> {
	return Object.fromEntries(
		[...switches].map(([variant, { on }]) => [variant, on])
	);
}
