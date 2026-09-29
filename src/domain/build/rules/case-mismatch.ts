import { joinPosix } from "../../../base/path.js";
import { BuildRule } from "../build-record.js";
import { declaredKeysOf } from "../declared-key.js";
import { diagnosePaths } from "../path-list.js";
import { RouteDiagnostics } from "../route-diagnostics.js";

/** A folder, marker or suffix that only differs from a declared key in letter case is read as an ordinary name. */
export const caseMismatch: BuildRule = ({ config, roots, readings }) => {
	const { tagKeys } = declaredKeysOf(config);
	const nearMisses = new Map<string, string>();
	const note = (resource: string, key: string | undefined) => {
		if (key && !nearMisses.has(resource)) nearMisses.set(resource, key);
	};

	for (const root of roots) {
		for (const marker of root.markers) {
			const resource = joinPosix(root.rootDir, marker);
			note(resource, readings.markers.get(resource)?.nearMissKey);
		}
		for (const entry of root.entries) {
			const read = readings.entries.get(entry.source);
			for (const folder of read?.folders ?? [])
				note(joinPosix(entry.rootDir, folder.dir), folder.nearMissKey);
			note(entry.source, read?.match.nearMissKey);
		}
	}

	return diagnosePaths([...nearMisses.keys()], (resource) => {
		const key = nearMisses.get(resource) as string;
		return RouteDiagnostics.caseMismatch(
			{ resource },
			tagKeys.has(key) ? "tag" : "route",
			key
		);
	});
};
