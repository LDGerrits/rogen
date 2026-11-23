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
					`"${key}" is not a Rojo or Rogen key.${suggestion ? ` Did you mean "${suggestion}"?` : " Remove it."}`,
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
