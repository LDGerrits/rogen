import { BuildRule } from "../build-record.js";
import { diagnosePaths } from "../path-list.js";
import { TagDiagnostics } from "../tag-diagnostics.js";

/** A capital suffix pruned a file whose name may only happen to end in a tag. */
export const dormantCapitalSuffix: BuildRule = ({ leftOut }) => {
	const byTag = new Map<string, Map<string, string>>();
	for (const [source, why] of leftOut) {
		if (why.status !== "pruned") continue;
		for (const { tag, separatorName } of why.tags)
			if (separatorName)
				byTag.set(
					tag,
					(byTag.get(tag) ?? new Map()).set(source, separatorName)
				);
	}
	return [...byTag].flatMap(([tag, separatorNames]) =>
		diagnosePaths([...separatorNames.keys()], (resource) =>
			TagDiagnostics.dormantCapitalSuffix(
				{ resource },
				tag,
				separatorNames.get(resource) as string
			)
		)
	);
};
