import { joinPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { RoutedFile } from "./route-files.js";
import { diagnosePaths } from "./path-list.js";
import { TagDiagnostics } from "./tag-diagnostics.js";

export interface TagResult {
	/** Every instance path appears once; the last root dir wins across roots. */
	readonly files: readonly RoutedFile[];
	/** Absolute POSIX source paths of the files that lost their instance path to another. */
	readonly superseded: readonly string[];
	/** Absolute POSIX source paths of the files a dormant tag removed. */
	readonly pruned: readonly string[];
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
	const pruned: string[] = [];
	const prunedOnCapital = new Map<string, Map<string, string>>();
	for (const file of routed) {
		const dormant = file.tags.filter(({ tag }) => !config.tags[tag]);
		if (dormant.length === 0) {
			kept.push(file);
			continue;
		}
		pruned.push(sourcePath(file));
		for (const { tag, separatorName } of dormant)
			if (separatorName)
				prunedOnCapital.set(
					tag,
					(prunedOnCapital.get(tag) ?? new Map()).set(
						sourcePath(file),
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
					{ resource: sourcePath(file) },
					file.buriedScriptSuffix
				)
			);

	const winners = new Map<string, RoutedFile>();
	for (const root of groupBy(kept, (file) => file.entry.rootDir).values()) {
		for (const [instance, claimants] of groupBy(root, (file) =>
			file.instancePath.join("/")
		)) {
			const tagged = claimants.filter((file) => file.tags.length > 0);
			const untagged = claimants.filter((file) => file.tags.length === 0);
			if (tagged.length > 1)
				errors.push(
					TagDiagnostics.activeClash(
						location,
						instance,
						tagged.map(sourcePath)
					)
				);
			else if (tagged.length === 0 && untagged.length > 1)
				warnings.push(
					TagDiagnostics.untaggedClash(
						location,
						instance,
						untagged.map(sourcePath)
					)
				);
			winners.set(instance, tagged[0] ?? untagged[untagged.length - 1]);
		}
	}

	if (errors.length > 0) return err(errors);
	const won = new Set(winners.values());
	const superseded = kept.filter((file) => !won.has(file)).map(sourcePath);
	return ok({ files: [...won], superseded, pruned, warnings });
}

function sourcePath(file: RoutedFile): string {
	return joinPosix(file.entry.rootDir, file.entry.relativePath);
}

function append<T>(groups: Map<string, T[]>, key: string, item: T): void {
	groups.set(key, [...(groups.get(key) ?? []), item]);
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string) {
	const groups = new Map<string, T[]>();
	for (const item of items) append(groups, keyOf(item), item);
	return groups;
}
