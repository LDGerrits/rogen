import { samePath, toPosix } from "../../base/path.js";
import { uniqueDiagnostics } from "../../platform/diagnostics/diagnostic.js";
import { SkippedPath } from "./write-service.js";
import { CoveredTargets } from "../config/config-service.js";
import {
	Asked,
	ConfigLocations,
	Diagnosis,
	Locations,
} from "./write-service.js";

export class AskedPaths {
	constructor(
		readonly args: readonly string[],
		readonly asked: readonly Asked[],
		private readonly covering: CoveredTargets,
		private readonly readers: ReadonlyMap<number, readonly string[]>
	) {}

	static pathAt(asked: readonly Asked[], index: number): string {
		return (asked[index] as { readonly path: string }).path;
	}

	get groups(): CoveredTargets["groups"] {
		return this.covering.groups;
	}

	argsAt(indexes: readonly number[]): string[] {
		return indexes.map((index) => this.args[index]);
	}

	get covered(): Asked[] {
		const uncovered = new Set(this.covering.uncovered);
		return this.asked.filter((_, index) => !uncovered.has(index));
	}

	get uncovered(): SkippedPath[] {
		const askedPaths = this.asked.flatMap((one) =>
			"path" in one ? [one.path] : []
		);
		return this.covering.uncovered.flatMap((index): SkippedPath[] => {
			const readers = this.readers.get(index)!;
			const askedReader = readers.some((reader) =>
				askedPaths.some((asked) => samePath(asked, reader))
			);
			if (askedReader) return [];
			return [
				{
					path: AskedPaths.pathAt(this.asked, index),
					reason: "noConfig",
					...(readers.length > 0 && { readers }),
				},
			];
		});
	}

	mergeDiagnoses(
		parts: readonly Omit<Diagnosis, "named">[]
	): Omit<Diagnosis, "named"> {
		const diagnostics = uniqueDiagnostics(
			parts.flatMap(({ diagnostics }) => diagnostics)
		);
		const stoppedBy = uniqueDiagnostics(
			parts.flatMap(({ stoppedBy }) => stoppedBy)
		);
		return {
			diagnostics,
			stoppedBy,
			failing: uniqueDiagnostics([...diagnostics, ...stoppedBy]),
			skipped: uniqueSkipped([
				...this.uncovered,
				...parts.flatMap(({ skipped }) => skipped),
			]),
		};
	}

	mergeLocations(parts: readonly Locations[]): Locations {
		const configs = parts.flatMap((part) => part.configs);
		return {
			everyFile: false,
			asked: this.covered,
			configs,
			errors: uniqueDiagnostics(parts.flatMap((part) => part.errors)),
			skipped: uniqueSkipped([
				...this.uncovered,
				...skippedByEveryConfig(configs),
			]),
		};
	}
}

function uniqueSkipped(skipped: readonly SkippedPath[]): SkippedPath[] {
	const seen = new Set<string>();
	return skipped.filter(({ path, reason, config }) => {
		const key = `${reason}\0${path}\0${config ?? ""}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function outsideEveryConfig(
	configs: readonly ConfigLocations[]
): string[] {
	const [first, ...others] = configs;
	if (!first) return [];
	return first.files
		.filter(({ status }) => status === "outside")
		.map(({ source }) => source)
		.filter((source) =>
			others.every(({ files }) =>
				files.some(
					(file) =>
						file.source === source && file.status === "outside"
				)
			)
		);
}

export function skippedOutside(
	sources: readonly string[],
	configs: readonly ConfigLocations[]
): SkippedPath[] {
	return sources.flatMap((path) =>
		configs.map(({ config }) => ({
			path,
			reason: "outsideSourcePaths" as const,
			config: toPosix(config.file),
		}))
	);
}

export function skippedByEveryConfig(
	configs: readonly ConfigLocations[]
): SkippedPath[] {
	return skippedOutside(outsideEveryConfig(configs), configs);
}
