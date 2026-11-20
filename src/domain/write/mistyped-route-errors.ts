import path from "path";
import { compareStrings } from "../../base/collections.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { NameReadings } from "./name-readings.js";

/** `resource` with the name of the route in it spelled as `key`, as `src/A/(SERVER)` → `src/A/(server)`. */
function spelledAs(resource: string, key: string): string {
	const name = path.posix.basename(resource);
	const at = name.toLowerCase().indexOf(key.toLowerCase());
	return path.posix.join(
		path.posix.dirname(resource),
		`${name.slice(0, at)}${key}${name.slice(at + key.length)}`
	);
}

const byResource = (a: Diagnostic, b: Diagnostic) =>
	compareStrings(a.resource, b.resource);

/** The errors for each name meant as a route that misses its key: an `@` that nearly spells one, in a file, folder or marker name, except in a file the tree takes the place of, and a folder or marker named for one in another letter case, except a folder an outer route governs, whose name places nothing. Such a file would land where its route doesn't reach, as server code at `*`, so the write stops instead. */
export function mistypedRouteErrors(
	readings: NameReadings,
	displaced: ReadonlySet<string>,
	governed: ReadonlySet<string>
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
	const cases = [...readings.nearMisses]
		.filter(([resource]) => !governed.has(resource))
		.map(([resource, key]) => {
			const sign = readings.markers.has(resource) ? "@" : "";
			return errorDiagnostic(
				"route.caseMismatch",
				{ resource },
				`differs from the route "${key}" only in letter case, so it would route nothing. Spell it "${sign}${key}", or declare it as written.`,
				[{ rename: { from: resource, to: spelledAs(resource, key) } }]
			);
		});
	return [...stray.sort(byResource), ...cases.sort(byResource)];
}
