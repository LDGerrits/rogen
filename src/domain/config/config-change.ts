import { newDiagnostics } from "../../platform/diagnostics/diagnostic.js";
import { ConfigEntry, ConfigNotice, validFile } from "./config-service.js";

/** One load of a config, with what tells its written version from another's. */
export interface ConfigVersion {
	readonly entry: ConfigEntry;
	/** The parsed value of the version it writes; none if it was never valid. */
	readonly written: string | undefined;
}

export interface ConfigChange {
	/** Whether what the config writes changed. */
	readonly changed: boolean;
	readonly notice?: ConfigNotice;
}

/** What a reload tells about one config; `before` is undefined for a config that came, `after` for one that left. */
export function configChange(
	before: ConfigVersion | undefined,
	after: ConfigVersion | undefined
): ConfigChange {
	if (!after)
		return {
			changed: false,
			notice: before && { kind: "removed", file: before.entry.file },
		};
	const { entry } = after;
	const changed =
		validFile(entry) !== undefined && before?.written !== after.written;
	if (entry.status === "valid") {
		if (!before)
			return { changed, notice: { kind: "added", file: entry.file } };
		return before.entry.status === "broken"
			? { changed, notice: { kind: "recovered", file: entry.file } }
			: { changed };
	}
	const errors = before
		? newDiagnostics(
				before.entry.status === "broken" ? before.entry.errors : [],
				entry.errors
			)
		: entry.errors;
	return errors.length > 0
		? {
				changed: false,
				notice: {
					kind: "broken",
					file: entry.file,
					errors,
					keptLastValid: entry.lastValid !== undefined,
				},
			}
		: { changed: false };
}
