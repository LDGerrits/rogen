import { relativeTo } from "../../base/path.js";
import { FileLocation, RouteMatch } from "../../domain/build/build-service.js";
import { instanceKey } from "../../domain/rojo/rojo-project.js";

const MATCH_LABELS: Record<RouteMatch, string> = {
	folder: "folder",
	marker: "marker",
	separator: "suffix",
	capital: "capital suffix",
	fallback: "fallback",
};

/** One line: the path, where it lands, and why. */
export function describeLocation(location: FileLocation, cwd: string): string {
	const relative = (file: string) => relativeTo(cwd, file);
	return `${relative(location.source)} -> ${outcomeOf(location, relative)}`;
}

function outcomeOf(
	location: FileLocation,
	relative: (file: string) => string
): string {
	switch (location.status) {
		case "placed": {
			const tags = location.tags.map(
				({ tag, form }) => `${tag} (${MATCH_LABELS[form]})`
			);
			const tagged =
				tags.length === 0
					? ""
					: ` · ${tags.length === 1 ? "tag" : "tags"} ${tags.join(", ")}`;
			return `${instanceKey(location.instancePath)} · route ${location.route} (${MATCH_LABELS[location.routeMatch]})${tagged}`;
		}
		case "pruned":
			return `pruned · tag ${location.tags[0].tag} is off (${MATCH_LABELS[location.tags[0].form]})`;
		case "replaced":
			return `replaced by ${relative(location.by)}`;
		case "displaced":
			return `displaced · the template defines ${instanceKey(location.node)}`;
		case "unrouted":
			return "unrouted · no route matches it";
		case "excluded":
			return `excluded · matches ${relative(location.pattern)}`;
		case "skipped":
			return "skipped · the link loops or points at nothing";
		case "outside":
			return "outside the root dirs";
		case "ignored":
			return "not an instance";
		case "missing":
			return "does not exist";
		case "empty":
			return "empty · no file in it places";
	}
}
