import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	replaceFixes,
} from "../../platform/diagnostics/diagnostic.js";
import {
	configRemovedFieldAdvice,
	rogenKeys,
	rojoKeys,
} from "./config-schema.js";

const KNOWN_KEYS: readonly string[] = [...rojoKeys, ...rogenKeys];

export class ConfigKeys {
	/** A removed key, or one neither Rojo's nor Rogen's, which Rojo would reject in the written file. */
	static check(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation,
		/** Whether `locationOf` points at the key, which a replacement needs, and not at its value. */
		atKey = true
	): Diagnostic[] {
		const errors: Diagnostic[] = [];
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
			errors.push(
				errorDiagnostic(
					"config.unknownField",
					location,
					`"${key}" is not a Rojo key and not Rogen's, and Rojo rejects a project file with a key it doesn't know.${suggestion ? ` Did you mean "${suggestion}"?` : ""}`,
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
		return errors;
	}
}
