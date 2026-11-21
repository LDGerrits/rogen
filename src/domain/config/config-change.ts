import { newDiagnostics } from "../../platform/diagnostics/diagnostic.js";
import { ConfigEntry, ConfigNotice, validFile } from "./config-service.js";

export interface ConfigVersion {
	readonly entry: ConfigEntry;
	readonly written: string | undefined;
}

export interface ConfigChange {
	readonly changed: boolean;
	readonly notice?: ConfigNotice;
}

export type ConfigTransition =
	| { readonly kind: "added"; readonly after: ConfigVersion }
	| { readonly kind: "removed"; readonly before: ConfigVersion }
	| {
			readonly kind: "reloaded";
			readonly before: ConfigVersion;
			readonly after: ConfigVersion;
	  };

export function configChange(transition: ConfigTransition): ConfigChange {
	if (transition.kind === "removed")
		return {
			changed: false,
			notice: { kind: "removed", file: transition.before.entry.file },
		};
	const { after } = transition;
	const before =
		transition.kind === "reloaded" ? transition.before : undefined;
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
