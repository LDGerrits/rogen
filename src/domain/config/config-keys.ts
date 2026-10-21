import { closestMatch } from "../../base/strings.js";
import {
	Diagnostic,
	DiagnosticLocation,
	errorDiagnostic,
	replaceFixes,
} from "../../platform/diagnostics/diagnostic.js";
import {
	ROGEN_BLOCK,
	configRemovedFieldAdvice,
	rogenKeys,
	rojoKeys,
} from "./config-schema.js";

export class ConfigKeys {
	/** A removed key, a Rogen key outside the `rogen` block, or one neither Rojo's nor Rogen's, which Rojo would reject in the written file. */
	static check(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation,
		/** Whether `locationOf` points at the key, which a replacement needs, and not at its value. */
		atKey = true,
		/** The text of a top-level entry, which moving a lone Rogen key into a new block replaces. */
		entryOf: (key: string) => string | undefined = () => undefined
	): Diagnostic[] {
		const misplaced = keys.filter((key) => rogenKeys.includes(key));
		const movable =
			atKey && misplaced.length === 1 && !keys.includes(ROGEN_BLOCK);
		return ConfigKeys.unknown(
			keys,
			[...rojoKeys, ROGEN_BLOCK],
			locationOf,
			atKey,
			(key, hint) =>
				`"${key}" is not a Rojo key and not Rogen's, and Rojo rejects a project file with a key it doesn't know.${hint}`,
			(key, location) => {
				if (!misplaced.includes(key)) return undefined;
				const entry = movable ? entryOf(key) : undefined;
				return errorDiagnostic(
					"config.rogenKeyOutsideBlock",
					location,
					`"${key}" is one of Rogen's keys, and the top level of the file is Rojo's. Move it into "${ROGEN_BLOCK}": { ... }.`,
					entry === undefined
						? []
						: replaceFixes(
								location,
								entry,
								`${JSON.stringify(ROGEN_BLOCK)}: { ${entry} }`
							)
				);
			}
		);
	}

	/** A key of the `rogen` block that is not Rogen's. */
	static checkBlock(
		keys: readonly string[],
		locationOf: (key: string) => DiagnosticLocation
	): Diagnostic[] {
		return ConfigKeys.unknown(
			keys,
			rogenKeys,
			locationOf,
			true,
			(key, hint) => `"${key}" is not one of Rogen's keys.${hint}`
		);
	}

	private static unknown(
		keys: readonly string[],
		known: readonly string[],
		locationOf: (key: string) => DiagnosticLocation,
		atKey: boolean,
		describe: (key: string, hint: string) => string,
		special: (
			key: string,
			location: DiagnosticLocation
		) => Diagnostic | undefined = () => undefined
	): Diagnostic[] {
		const errors: Diagnostic[] = [];
		for (const key of keys) {
			if (known.includes(key)) continue;
			const location = locationOf(key);
			const found =
				special(key, location) ??
				configRemovedFieldAdvice(key, location);
			if (found) {
				errors.push(found);
				continue;
			}
			const suggestion = closestMatch(
				key,
				known.filter((other) => !keys.includes(other))
			);
			errors.push(
				errorDiagnostic(
					"config.unknownField",
					location,
					describe(
						key,
						suggestion ? ` Did you mean "${suggestion}"?` : ""
					),
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
