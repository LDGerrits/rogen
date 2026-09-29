import { groupBy } from "../../../../base/collection.js";
import { Result, err, ok } from "../../../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../../../platform/diagnostics/diagnostic.js";
import { instanceKey } from "../../../rojo/rojo-tree.js";
import { PreparedBuild } from "../../model/build-phases.js";
import { InstanceClash, LeftOut, RoutedFile } from "../../model/routed.js";

export interface Tagging {
	/** Every instance path appears once per build; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** The files pruned by a dormant tag and those another file replaced. */
	readonly leftOut: ReadonlyMap<string, LeftOut>;
	readonly clashes: readonly InstanceClash[];
}

/** Prunes what dormant tags remove, then resolves files that share an instance path. */
export function applyTags(
	{ config }: Pick<PreparedBuild, "config">,
	routed: readonly RoutedFile[]
): Result<Tagging, Diagnostic[]> {
	const leftOut = new Map<string, LeftOut>();
	const kept: RoutedFile[] = [];
	for (const file of routed) {
		const dormant = file.tags.filter(({ tag }) => !config.tags[tag]);
		if (dormant.length === 0) kept.push(file);
		else
			leftOut.set(file.entry.source, { status: "pruned", tags: dormant });
	}

	const errors: Diagnostic[] = [];
	const clashes: InstanceClash[] = [];
	const winners = new Map<string, RoutedFile>();
	for (const root of groupBy(kept, (file) => file.entry.rootDir).values()) {
		for (const [instance, claimants] of groupBy(root, (file) =>
			instanceKey(file.instancePath)
		)) {
			const tagged = claimants.filter((file) => file.tags.length > 0);
			const untagged = claimants.filter((file) => file.tags.length === 0);
			if (tagged.length > 1)
				errors.push(
					errorDiagnostic(
						"tag.activeClash",
						{ resource: config.outFile },
						`${tagged.length} files with active tags all become "${instance}" (${tagged.map(({ entry }) => entry.source).join(", ")}). Only one can apply: turn a tag off or rename a file.`
					)
				);
			else if (claimants.length > 1)
				clashes.push({ instance, claimants });
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
	return ok({ files: [...new Set(winners.values())], leftOut, clashes });
}
