import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	replaceFixes,
	warningDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	configRemovedFieldAdvice,
	rogenKeys,
	rojoKeys,
} from "./config-schema.js";

const KNOWN_KEYS: readonly string[] = [...rojoKeys, ...rogenKeys];

export class ConfigKeys {
	/** A removed key is an error; a key neither Rojo's nor Rogen's passes through with a warning. */
	static check(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation,
		/** Whether `locationOf` points at the key, which a replacement needs, and not at its value. */
		atKey = true
	): { readonly errors: Diagnostic[]; readonly warnings: Diagnostic[] } {
		const errors: Diagnostic[] = [];
		const warnings: Diagnostic[] = [];
		for (const key of keys) {
			if (KNOWN_KEYS.includes(key)) continue;
			const location = locationOf(key);
			const removed = configRemovedFieldAdvice(key, location);
			if (removed) {
				errors.push(removed);
				continue;
			}
			const suggestion = closestMatch(
				key,
				KNOWN_KEYS.filter((other) => !keys.includes(other))
			);
			warnings.push(
				warningDiagnostic(
					"config.unknownField",
					location,
					`"${key}" is not a Rojo key and not Rogen's: it is passed through, and Rojo will reject the written file by this name.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
					suggestion && atKey
						? replaceFixes(
								location,
								JSON.stringify(key),
								JSON.stringify(suggestion)
							)
						: []
				)
			);
		}
		return { errors, warnings };
	}
}
