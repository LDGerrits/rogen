import path from "path";
import { compareStrings } from "../../base/collections.js";
import {
	Diagnostic,
	DiagnosticFix,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { governingRouteOf } from "./governing-route-of.js";
import { NameReadings } from "./name-readings.js";
import { RoutedFile } from "./router.js";

const byResource = (a: Diagnostic, b: Diagnostic) =>
	compareStrings(a.resource, b.resource);

/** `resource` with the name of the route in it spelled as `key`, as `src/A/(SERVER)` → `src/A/(server)`. */
function spelledAs(resource: string, key: string): string {
	const name = path.posix.basename(resource);
	const at = name.toLowerCase().indexOf(key.toLowerCase());
	return path.posix.join(
		path.posix.dirname(resource),
		`${name.slice(0, at)}${key}${name.slice(at + key.length)}`
	);
}

/** What the errors read besides the readings. */
export interface MistypedRouteInputs {
	readonly routed: readonly RoutedFile[];
	/** The files the tree takes the place of, which Rogen doesn't route. */
	readonly displaced: ReadonlySet<string>;
	/** The folders named for a route in another case that a route above, or a marker in them, governs. */
	readonly governed: ReadonlySet<string>;
	/** Whether a path is already there, so a rename onto it would clash. */
	readonly exists: (target: string) => boolean;
	/** The one name key whose target is the `*` route's, whose marker keeps a folder's files where `*` puts them. */
	readonly fallbackKey?: string;
}

/** The errors for each name meant as a route that misses its key, which would send its files where their route doesn't reach, as server code to `*`: an `@` that nearly spells a key, in a file, folder or marker name (`route.strayAt`), and a folder named for one in another letter case (`route.caseMismatch`), which in a script folder may instead be a child the script requires, so there it names a marker as well and has no one fix. Under a route that governs it, an `@` for another route names nothing whatever its spelling (`route.ignoredAt`), a folder's name places nothing, and a file the tree takes the place of is not routed, so none of those is reported as a misspelling. */
export function mistypedRouteErrors(
	readings: NameReadings,
	{ routed, displaced, governed, exists, fallbackKey }: MistypedRouteInputs
): Diagnostic[] {
	const renamed = (from: string, to: string | undefined): DiagnosticFix[] =>
		to !== undefined && !exists(to) ? [{ rename: { from, to } }] : [];
	const stray = (
		resource: string,
		written: string,
		key: string,
		message: string,
		to: string | undefined
	): Diagnostic => {
		const marker = readings.markers.has(resource);
		const governing = governingRouteOf(
			marker ? path.posix.dirname(resource) : resource,
			routed,
			marker
		);
		if (governing === undefined || governing === key)
			return errorDiagnostic(
				"route.strayAt",
				{ resource },
				message,
				renamed(resource, to)
			);
		const kind = routed.some(({ entry }) => entry.source === resource)
			? "file"
			: "folder";
		return errorDiagnostic(
			"route.ignoredAt",
			{ resource },
			`"${written}" does nothing here, because the "${governing}" route already governs this ${kind}. Remove it, or move the ${kind} out of the "${governing}" route's files.`
		);
	};
	const strays = [...readings.misspelt("strayAt")]
		.filter(([resource]) => !displaced.has(resource))
		.map(([resource, { text, suggestion, notLast, renamedTo }]) =>
			stray(
				resource,
				`@${text}`,
				suggestion.slice(1),
				notLast
					? `"@${text}" must end the name to route it`
					: `"@${text}" names no route; did you mean "${suggestion}"?`,
				renamedTo
			)
		);
	const markers = [...readings.nearMisses]
		.filter(([resource]) => readings.markers.has(resource))
		.map(([resource, key]) => {
			const written = path.posix.basename(resource);
			return stray(
				resource,
				written,
				key,
				`"${written}" names no route; did you mean "@${key}"?`,
				spelledAs(resource, key)
			);
		});
	const scriptFolders = new Set(
		[...readings.entries]
			.filter(([, { isInit }]) => isInit)
			.map(([source]) => path.posix.dirname(source))
	);
	const folders = [...readings.nearMisses]
		.filter(
			([resource]) =>
				!readings.markers.has(resource) && !governed.has(resource)
		)
		.map(([resource, key]) => {
			const written = path.posix.basename(resource);
			const inScript = scriptFolders.has(path.posix.dirname(resource));
			const keep =
				inScript && fallbackKey !== undefined
					? `, or, if the script beside it requires it as a child, add a marker file @${fallbackKey} in it to keep it there`
					: "";
			return errorDiagnostic(
				"route.caseMismatch",
				{ resource },
				`"${written}" differs from the route "${key}" only in letter case, so it would route nothing and its files would go to "*". Spell it "${key}"${keep}.`,
				inScript ? [] : renamed(resource, spelledAs(resource, key))
			);
		});
	const ignored = [...strays, ...markers].filter(
		({ code }) => code === "route.ignoredAt"
	);
	return [
		...[...strays, ...markers]
			.filter(({ code }) => code === "route.strayAt")
			.sort(byResource),
		...folders.sort(byResource),
		...ignored.sort(byResource),
	];
}
