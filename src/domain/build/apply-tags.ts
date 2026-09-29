import { groupBy } from "../../base/collection.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { instanceKey } from "../rojo/rojo-tree.js";
import { LeftOut } from "./left-out.js";
import { RoutedFile } from "./route-files.js";
import { diagnosePaths } from "./path-list.js";
import { TagDiagnostics } from "./tag-diagnostics.js";

export interface TagResult {
	/** Every instance path appears once; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** The files a dormant tag removed and the files that lost their instance path to another, by absolute POSIX path. */
	readonly leftOut: ReadonlyMap<string, LeftOut>;
	readonly warnings: readonly Diagnostic[];
}

/** Prunes what dormant tags remove, then resolves files that share an instance path. */
export function applyTags(
	routed: readonly RoutedFile[],
	config: Pick<ResolvedConfig, "tags" | "outFile">
): Result<TagResult, Diagnostic[]> {
	const location = { resource: config.outFile };
	const warnings: Diagnostic[] = [];
	const errors: Diagnostic[] = [];

	const kept: RoutedFile[] = [];
	const leftOut = new Map<string, LeftOut>();
	const prunedOnCapital = new Map<string, Map<string, string>>();
	for (const file of routed) {
		const dormant = file.tags.filter(({ tag }) => !config.tags[tag]);
		if (dormant.length === 0) {
			kept.push(file);
			continue;
		}
		leftOut.set(file.entry.source, { status: "pruned", tags: dormant });
		for (const { tag, separatorName } of dormant)
			if (separatorName)
				prunedOnCapital.set(
					tag,
					(prunedOnCapital.get(tag) ?? new Map()).set(
						file.entry.source,
						separatorName
					)
				);
	}
	for (const [tag, separatorNames] of prunedOnCapital)
		warnings.push(
			...diagnosePaths([...separatorNames.keys()], (resource) =>
				TagDiagnostics.dormantCapitalSuffix(
					{ resource },
					tag,
					separatorNames.get(resource) as string
				)
			)
		);

	for (const file of kept)
		if (file.buriedScriptSuffix)
			warnings.push(
				TagDiagnostics.buriedScriptSuffix(
					{ resource: file.entry.source },
					file.buriedScriptSuffix
				)
			);

	const winners = new Map<string, RoutedFile>();
	for (const root of groupBy(kept, (file) => file.entry.rootDir).values()) {
		for (const [instance, claimants] of groupBy(root, (file) =>
			instanceKey(file.instancePath)
		)) {
			const tagged = claimants.filter((file) => file.tags.length > 0);
			const untagged = claimants.filter((file) => file.tags.length === 0);
			if (tagged.length > 1)
				errors.push(
					TagDiagnostics.activeClash(
						location,
						instance,
						tagged.map(({ entry }) => entry.source)
					)
				);
			else if (tagged.length === 0 && untagged.length > 1)
				warnings.push(
					TagDiagnostics.untaggedClash(
						location,
						instance,
						untagged.map(({ entry }) => entry.source)
					)
				);
			winners.set(instance, tagged[0] ?? untagged[untagged.length - 1]);
		}
	}

	if (errors.length > 0) return err(errors);
	for (const file of kept) {
		const winner = winners.get(instanceKey(file.instancePath));
		if (winner && winner !== file)
			leftOut.set(file.entry.source, {
				status: "replaced",
				by: winner.entry.source,
			});
	}
	return ok({
		files: [...new Set(winners.values())],
		leftOut,
		warnings,
	});
}
