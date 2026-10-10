import { groupBy } from "../../base/collections.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticCollector } from "../../platform/diagnostics/diagnostic-collector.js";
import { ResolvedConfig } from "../config/config.js";
import { InstanceMap, instanceKey } from "../rojo/rojo-project.js";
import { LeftOut } from "./build.js";
import { RoutedFile } from "./router.js";

/** Plain files from one root dir that claim one instance path; the last one wins and the others are replaced. */
export interface InstanceClash {
	readonly instance: string;
	readonly winner: RoutedFile;
	readonly losers: readonly RoutedFile[];
}

export interface VariantOutcome {
	/** Every instance path appears once per build; the last root dir wins across roots. */
	readonly nodes: readonly RoutedFile[];
	/** The files pruned by a dormant variant and those another file replaced. */
	readonly leftOut: [string, LeftOut][];
	readonly clashes: InstanceClash[];
}

/** Decides which of the routed files an active variant leaves in the tree: dormant variants are pruned, and files that share an instance path give way to one. */
export class VariantResolution {
	constructor(private readonly config: ResolvedConfig) {}

	/** Prunes what dormant variants remove, then resolves files that share an instance path. */
	apply(routed: readonly RoutedFile[]): Result<VariantOutcome, Diagnostic[]> {
		const { kept, pruned } = this.pruneDormant(routed);
		const resolved = this.resolveClaimants(kept);
		if (resolved.isErr()) return resolved;
		const { winners, clashes } = resolved.value;
		const replaced = kept.flatMap((file): [string, LeftOut][] => {
			const winner = winners.get(file.instancePath);
			return winner && winner !== file
				? [
						[
							file.entry.source,
							{ status: "replaced", by: winner.entry.source },
						],
					]
				: [];
		});
		return ok({
			nodes: [...new Set(winners.values())],
			leftOut: [...pruned, ...replaced],
			clashes,
		});
	}

	/** The files whose variants are all on, and the paths left out for one that is off. */
	private pruneDormant(routed: readonly RoutedFile[]): {
		kept: RoutedFile[];
		pruned: [string, LeftOut][];
	} {
		const kept: RoutedFile[] = [];
		const pruned: [string, LeftOut][] = [];
		for (const file of routed) {
			const dormant = this.config.dormantVariants(file.variants);
			if (dormant.length === 0) kept.push(file);
			else
				pruned.push([
					file.entry.source,
					{ status: "pruned", variants: dormant },
				]);
		}
		return { kept, pruned };
	}

	/** The file that gives each instance path, per root dir: the one whose active variants include every other claimant's, else the last plain one. Two files neither of which has all of the other's variants can't both apply. */
	private resolveClaimants(kept: readonly RoutedFile[]): Result<
		{
			winners: InstanceMap<RoutedFile>;
			clashes: InstanceClash[];
		},
		Diagnostic[]
	> {
		const problems = new DiagnosticCollector();
		// A copied init script meets the same files at every node it is copied to, so each is reported once.
		const reported = new Set<string>();
		const clashes: InstanceClash[] = [];
		const winners = new InstanceMap<RoutedFile>();
		for (const root of groupBy(
			kept,
			(file) => file.entry.rootDir
		).values()) {
			for (const [instance, claimants] of groupBy(root, (file) =>
				instanceKey(file.instancePath)
			)) {
				const top = VariantResolution.mostSpecific(claimants);
				const variantFiles = top.filter(
					(file) => file.variants.length > 0
				);
				const plain = top.filter((file) => file.variants.length === 0);
				if (variantFiles.length > 1) {
					for (const { entry } of variantFiles) {
						if (reported.has(entry.source)) continue;
						reported.add(entry.source);
						const others = variantFiles
							.filter((other) => other.entry !== entry)
							.map((other) => other.entry.source);
						problems.error(
							"variant.activeClash",
							{ resource: entry.source },
							`becomes "${instance}" with an active variant, and so ${others.length === 1 ? "does" : "do"} ${others.join(", ")}. Only one can apply: turn a variant off or rename a file.`
						);
					}
				}
				const winner = variantFiles[0] ?? plain[plain.length - 1];
				// A variant file replacing a plain one is what variants are for, so only plain files clash.
				if (variantFiles.length === 0 && plain.length > 1)
					clashes.push({
						instance,
						winner,
						losers: plain.slice(0, -1),
					});
				winners.set(claimants[0].instancePath, winner);
			}
		}
		return problems.hasErrors
			? err([...problems.diagnostics])
			: ok({ winners, clashes });
	}

	/** The claimants no other outranks by having every variant they have and more; a plain file has none, so any variant file outranks it. */
	private static mostSpecific(
		claimants: readonly RoutedFile[]
	): RoutedFile[] {
		const sets = claimants.map(
			(file) => new Set(file.variants.map(({ variant }) => variant))
		);
		return claimants.filter((_, index) =>
			sets.every(
				(other) =>
					other.size <= sets[index].size ||
					[...sets[index]].some((variant) => !other.has(variant))
			)
		);
	}
}
