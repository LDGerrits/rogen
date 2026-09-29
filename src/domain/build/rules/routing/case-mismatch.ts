import { joinPosix } from "../../../../base/path.js";
import { warningDiagnostic } from "../../../../platform/diagnostics/diagnostic.js";
import { Registry } from "../../../../platform/registry/registry.js";
import { withFirstLetterFlipped } from "../../keys/declared-key.js";
import { diagnosePaths } from "../path-list.js";
import { BuildRule, Extensions, RuleRegistry } from "../rule-registry.js";

/** A folder, marker or suffix that only differs from a declared key in letter case is read as an ordinary name. */
export const caseMismatch: BuildRule = {
	id: "case-mismatch",
	order: 40,
	check: ({ keys, roots, readings }) => {
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
					note(
						joinPosix(entry.rootDir, folder.dir),
						folder.nearMissKey
					);
				note(entry.source, read?.match.nearMissKey);
			}
		}

		return diagnosePaths([...nearMisses.keys()], (resource) => {
			const key = nearMisses.get(resource) as string;
			const kind = keys.tagKeys.has(key) ? "tag" : "route";
			return warningDiagnostic(
				"route.caseMismatch",
				{ resource },
				`differs from the ${kind} "${key}" only in letter case, so it is read as an ordinary name. Spell it "${key}" or "${withFirstLetterFlipped(key)}", or declare it as written.`
			);
		});
	},
};

Registry.as<RuleRegistry>(Extensions.Rules).registerRule(caseMismatch);
