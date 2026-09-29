import path from "path";
import { FileLocation } from "../../domain/build/locate-files.js";

/** One line: the path, where it lands, and why. */
export function describeLocation(location: FileLocation, cwd: string): string {
	const relative = (file: string) => path.relative(cwd, file) || ".";
	return `${relative(location.source)} -> ${outcomeOf(location, relative)}`;
}

function outcomeOf(
	location: FileLocation,
	relative: (file: string) => string
): string {
	switch (location.status) {
		case "placed": {
			const tags =
				location.tags.length === 0
					? ""
					: ` · ${location.tags.length === 1 ? "tag" : "tags"} ${location.tags.join(", ")}`;
			return `${location.instancePath.join("/")} · route ${location.route} (${location.routeMatch})${tags}`;
		}
		case "pruned":
			return `pruned · tag ${location.tag} is off`;
		case "replaced":
			return `replaced by ${relative(location.by)}`;
		case "unrouted":
			return "unrouted · no route matches it";
		case "excluded":
			return "excluded";
		case "skipped":
			return "skipped · the link loops or points at nothing";
		case "outside":
			return "outside the root dirs";
		case "ignored":
			return "not an instance";
		case "missing":
			return "does not exist";
	}
}
