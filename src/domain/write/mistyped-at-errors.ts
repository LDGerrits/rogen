import { compareStrings } from "../../base/collections.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { NameReadings } from "./name-readings.js";

const byResource = (a: Diagnostic, b: Diagnostic) =>
	compareStrings(a.resource, b.resource);

/** The errors for each `@` that nearly spells a route key, in a file, folder or marker name, except in a file the tree takes the place of: an `@` can only mean a route, so a mistyped one stops the write rather than send a file where its route doesn't reach. */
export function mistypedAtErrors(
	readings: NameReadings,
	displaced: ReadonlySet<string>
): Diagnostic[] {
	const stray = [...readings.misspelt("strayAt")]
		.filter(([resource]) => !displaced.has(resource))
		.map(([resource, { text, suggestion, notLast, renamedTo }]) =>
			errorDiagnostic(
				"route.strayAt",
				{ resource },
				notLast
					? `"@${text}" must end the name`
					: `did you mean "${suggestion}"?`,
				renamedTo ? [{ rename: { from: resource, to: renamedTo } }] : []
			)
		);
	const markers = [...readings.nearMisses]
		.filter(([resource]) => readings.markers.has(resource))
		.map(([resource, key]) =>
			errorDiagnostic(
				"route.caseMismatch",
				{ resource },
				`differs from the route "${key}" only in letter case, and an "@" only names a route. Spell it "@${key}", or declare it as written.`
			)
		);
	return [...stray.sort(byResource), ...markers.sort(byResource)];
}
