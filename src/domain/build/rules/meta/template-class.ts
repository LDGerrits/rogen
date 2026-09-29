import { instanceKey } from "../../../rojo/rojo-tree.js";
import { BuildRule } from "../../build-record.js";
import { MetaDiagnostics } from "../../meta-diagnostics.js";

export const templateClass: BuildRule = ({ config, metaOutcomes }) =>
	metaOutcomes.flatMap((outcome) => {
		if (outcome.kind !== "copied") return [];
		const { instancePath, meta, templateNode } = outcome;
		if (
			templateNode.$className === undefined ||
			meta.className === undefined ||
			templateNode.$className === meta.className
		)
			return [];
		return [
			MetaDiagnostics.templateClass(
				{ resource: config.outFile },
				instanceKey(instancePath),
				templateNode.$className,
				meta.file,
				meta.className
			),
		];
	});
