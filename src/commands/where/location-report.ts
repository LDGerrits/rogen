import { groupBy } from "../../base/collections.js";
import { relativeTo } from "../../base/path.js";
import { FileLocation, RouteMatch } from "../../domain/build/build-service.js";
import { instanceKey } from "../../domain/rojo/rojo-project.js";

interface ConfigLines {
	readonly label: string;
	/** Each line with the source path it is about. */
	readonly lines: readonly (readonly [source: string, line: string])[];
}

const MATCH_LABELS: Record<RouteMatch, string> = {
	folder: "folder",
	marker: "marker",
	separator: "suffix",
	capital: "capital suffix",
	fallback: "fallback",
};

/** One line: the path, where it lands, and why. */
function describeLocation(location: FileLocation, cwd: string): string {
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

/** Where files land, one line per path however many configs answered. */
export class LocationReport {
	private readonly configs: ConfigLines[] = [];

	constructor(private readonly cwd: string) {}

	/** What `label`'s config says about each location. */
	add(label: string, locations: readonly FileLocation[]): void {
		this.configs.push({
			label,
			lines: locations.map((location) => [
				location.source,
				describeLocation(location, this.cwd),
			]),
		});
	}

	/** One line per path when every config agrees; otherwise each config's line, headed by its name. Paths keep the order they were first given in, or are sorted. */
	lines(sorted = false): string[] {
		const bySource = groupBy(
			this.configs.flatMap(({ label, lines }) =>
				lines.map(([source, line]) => ({ source, label, line }))
			),
			({ source }) => source
		);

		const sources = [...bySource.keys()];
		if (sorted) sources.sort();
		return sources.flatMap((source) => {
			const answers = bySource.get(source) ?? [];
			const [first] = answers;
			const agreed =
				answers.length === this.configs.length &&
				answers.every(({ line }) => line === first.line);
			return agreed || this.configs.length === 1
				? [first.line]
				: answers.map(({ label, line }) => `${label}: ${line}`);
		});
	}
}
