import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	replaceFixes,
} from "../../platform/diagnostics/diagnostic.js";
import { rojoKeys } from "./config-structure.js";
import { ROGEN_KEYS } from "./config.js";

const knownKeys: readonly string[] = [...rojoKeys, ...ROGEN_KEYS];

export class ConfigKeys {
	/** A key neither Rojo's nor Rogen's, which Rojo would reject in the written file. */
	static check(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation
	): Diagnostic[] {
		return keys
			.filter((key) => !knownKeys.includes(key))
			.map((key) => {
				const location = locationOf(key);
				const suggestion = closestMatch(
					key,
					knownKeys.filter((other) => !keys.includes(other))
				);
				return errorDiagnostic(
					"config.unknownField",
					location,
					`"${key}" is not a Rojo key and not Rogen's, and Rojo rejects a project file with a key it doesn't know.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
					suggestion
						? replaceFixes(
								location,
								JSON.stringify(key),
								JSON.stringify(suggestion)
							)
						: []
				);
			});
	}
}
