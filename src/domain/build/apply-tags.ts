import { groupBy } from "../../base/collection.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { instanceKey } from "../rojo/rojo-tree.js";
import { RoutedFile, TagMatch } from "./route-files.js";
import { diagnosePaths } from "./path-list.js";
import { TagDiagnostics } from "./tag-diagnostics.js";

export interface TagResult {
	/** Every instance path appears once; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** Absolute POSIX source paths of the files that lost their instance path to another. */
	readonly superseded: readonly string[];
	/** Each superseded path, with the path of the file that took its instance path. */
	readonly supersededBy: ReadonlyMap<string, string>;
	/** Absolute POSIX source paths of the files a dormant tag removed. */
	readonly pruned: readonly string[];
	/** Each pruned path, with the first dormant tag it carries. */
	readonly prunedBy: ReadonlyMap<string, TagMatch>;
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
	const prunedBy = new Map<string, TagMatch>();
	const prunedOnCapital = new Map<string, Map<string, string>>();
	for (const file of routed) {
		const dormant = file.tags.filter(({ tag }) => !config.tags[tag]);
		if (dormant.length === 0) {
			kept.push(file);
			continue;
		}
		prunedBy.set(file.entry.source, dormant[0]);
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
	const supersededBy = new Map<string, string>();
	for (const file of kept) {
		const winner = winners.get(instanceKey(file.instancePath));
		if (winner && winner !== file)
			supersededBy.set(file.entry.source, winner.entry.source);
	}
	return ok({
		files: [...new Set(winners.values())],
		superseded: [...supersededBy.keys()],
		supersededBy,
		pruned: [...prunedBy.keys()],
		prunedBy,
		warnings,
	});
}
