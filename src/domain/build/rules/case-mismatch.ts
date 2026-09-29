import path from "path";
import { joinPosix } from "../../../base/path.js";
import { BuildRule } from "../build-record.js";
import {
	declaredKeysOf,
	matchKeyIgnoringCase,
	matchSuffixKeys,
	readFolderName,
} from "../declared-key.js";
import { diagnosePaths } from "../path-list.js";
import { RouteDiagnostics } from "../route-diagnostics.js";
import { suffixedNameOf } from "../stages/route-files.js";

/** A folder, marker or suffix that only differs from a declared key in letter case is read as an ordinary name. */
export const caseMismatch: BuildRule = ({ config, roots }) => {
	const { routeKeys, tagKeys, all: declaredKeys } = declaredKeysOf(config);
	const nearMisses = new Map<string, string>();
	const note = (resource: string, key: string | undefined) => {
		if (key && !nearMisses.has(resource)) nearMisses.set(resource, key);
	};

	for (const root of roots) {
		for (const marker of root.markers)
			note(
				joinPosix(root.rootDir, marker),
				matchKeyIgnoringCase(
					path.posix.basename(marker).slice(1),
					declaredKeys
				)
			);
		for (const entry of root.entries) {
			const folderNames = entry.relativePath.split("/").slice(0, -1);
			let dir = "";
			for (const segment of folderNames) {
				dir = dir ? `${dir}/${segment}` : segment;
				const folder = readFolderName(segment, routeKeys, tagKeys);
				if (folder.kind === "plain")
					note(
						joinPosix(entry.rootDir, dir),
						matchKeyIgnoringCase(folder.name, declaredKeys)
					);
			}
			const { stem } = suffixedNameOf(entry);
			note(entry.source, matchSuffixKeys(stem, declaredKeys).nearMissKey);
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
