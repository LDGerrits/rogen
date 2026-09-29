import { BuildRule } from "../../build-record.js";
import { TagDiagnostics } from "../../tag-diagnostics.js";

/** Only one untagged file can become an instance; a tagged one replacing it is the point of tags. */
export const untaggedClash: BuildRule = ({ config, clashes }) =>
	clashes
		.filter(({ claimants }) =>
			claimants.every((file) => file.tags.length === 0)
		)
		.map(({ instance, claimants }) =>
			TagDiagnostics.untaggedClash(
				{ resource: config.outFile },
				instance,
				claimants.map(({ entry }) => entry.source)
			)
		);
