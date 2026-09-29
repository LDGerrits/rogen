import { groupBy } from "../../../../base/collection.js";
import { err, ok } from "../../../../base/result.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../../../platform/diagnostics/diagnostic.js";
import { instanceKey } from "../../../rojo/rojo-tree.js";
import {
	InstanceClash,
	LeftOut,
	PlacementStage,
	RoutedFile,
} from "../../build-record.js";

/** Prunes what dormant tags remove, then resolves files that share an instance path. */
export const applyTags: PlacementStage = (build) => {
	const { config } = build;
	const leftOut = new Map<string, LeftOut>(build.leftOut);
	const kept: RoutedFile[] = [];
	for (const file of build.routed) {
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
	return ok({
		...build,
		files: [...new Set(winners.values())],
		leftOut,
		clashes,
	});
};
