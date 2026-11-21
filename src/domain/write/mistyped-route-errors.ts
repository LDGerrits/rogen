import path from "path";
import { compareStrings } from "../../base/collections.js";
import {
	Diagnostic,
	DiagnosticFix,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import {
	governingRouteOf,
	governingRouteOfMarkerFolder,
} from "./governing-route-of.js";
import { NameReadings } from "./name-readings.js";
import { RoutedFile } from "./router.js";

const byResource = (a: Diagnostic, b: Diagnostic) =>
	compareStrings(a.resource, b.resource);

function spelledAs(resource: string, key: string): string {
	const name = path.posix.basename(resource);
	const at = name.toLowerCase().indexOf(key.toLowerCase());
	return path.posix.join(
		path.posix.dirname(resource),
		`${name.slice(0, at)}${key}${name.slice(at + key.length)}`
	);
}

export interface MistypedRouteInputs {
	readonly routed: readonly RoutedFile[];
	readonly displaced: ReadonlySet<string>;
	readonly governed: ReadonlySet<string>;
	readonly exists: (target: string) => boolean;
	readonly fallbackKey?: string;
}

export function mistypedRouteErrors(
	readings: NameReadings,
	{ routed, displaced, governed, exists, fallbackKey }: MistypedRouteInputs
): Diagnostic[] {
	const isMarker = (resource: string) => readings.markers.has(resource);
	const isDisplaced = (resource: string) => displaced.has(resource);
	const isGovernedFolder = (resource: string) => governed.has(resource);
	const governingRoute = (resource: string) =>
		isMarker(resource)
			? governingRouteOfMarkerFolder(path.posix.dirname(resource), routed)
			: governingRouteOf(resource, routed);
	const isIgnoredAt = (
		governing: string | undefined,
		key: string
	): governing is string => governing !== undefined && governing !== key;
	const isCaseMismatch = (resource: string) =>
		!isMarker(resource) && !isGovernedFolder(resource);

	const renamed = (from: string, to: string | undefined): DiagnosticFix[] =>
		to !== undefined && !exists(to) ? [{ rename: { from, to } }] : [];
	const atError = (
		resource: string,
		written: string,
		key: string,
		message: string,
		to: string | undefined
	): Diagnostic => {
		const governing = governingRoute(resource);
		if (!isIgnoredAt(governing, key))
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
		.filter(([resource]) => !isDisplaced(resource))
		.map(([resource, { text, suggestion, notLast, renamedTo }]) =>
			atError(
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
		.filter(([resource]) => isMarker(resource))
		.map(([resource, key]) => {
			const written = path.posix.basename(resource);
			return atError(
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
		.filter(([resource]) => isCaseMismatch(resource))
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
				`"${written}" differs from the route "${key}" only in letter case, so it routes nothing, and the files in it that nothing else routes go to "*". Spell it "${key}"${keep}.`,
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
