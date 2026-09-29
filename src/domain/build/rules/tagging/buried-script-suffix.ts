import { BuildRule } from "../../build-record.js";
import { TagDiagnostics } from "../../tag-diagnostics.js";

export const buriedScriptSuffix: BuildRule = ({ routed, leftOut }) =>
	routed.flatMap((file) =>
		file.buriedScriptSuffix &&
		leftOut.get(file.entry.source)?.status !== "pruned"
			? [
					TagDiagnostics.buriedScriptSuffix(
						{ resource: file.entry.source },
						file.buriedScriptSuffix
					),
				]
			: []
	);
