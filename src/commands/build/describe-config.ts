import path from "path";
import { ConfigEntry } from "../../domain/config/config-service.js";

/** The `extends` chain and skipped tag flags, for `--verbose`. */
export function describeConfig(entry: ConfigEntry, cwd: string): string[] {
	const parents = entry.chain
		.slice(1)
		.map((file) => path.relative(cwd, file) || ".");
	return [
		...(parents.length > 0 ? [`extends: ${parents.join(" -> ")}`] : []),
		...entry.skippedTags.map(
			(tag) => `tag ${tag} skipped: not declared in this config`
		),
	];
}
