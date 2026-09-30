import { groupBy } from "../../base/collections.js";
import { relativeTo } from "../../base/path.js";
import {
	FileLocation,
	InstanceLocation,
	RouteMatch,
} from "../../domain/build/build-service.js";
import { instanceKey } from "../../domain/rojo/rojo-project.js";

/** What one config says about a source: a location, or that no file places the instance named by `source`. */
interface Answer {
	readonly label: string;
	readonly source: string;
	readonly location?: FileLocation;
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

/** The fields a location adds to its source and status in the JSON form. */
function locationFields(location: FileLocation): Record<string, unknown> {
	switch (location.status) {
		case "placed":
			return {
				instancePath: location.instancePath,
				route: location.route,
				routeMatch: location.routeMatch,
				tags: location.tags.map(({ tag, form }) => ({ tag, form })),
			};
		case "pruned":
			return {
				tags: location.tags.map(({ tag, form }) => ({ tag, form })),
			};
		case "replaced":
			return { by: location.by };
		case "displaced":
			return { node: location.node };
		case "excluded":
			return { pattern: location.pattern };
		default:
			return {};
	}
}

/** Where files land, one line per path however many configs answered. */
export class LocationReport {
	private readonly answers: Answer[] = [];
	private configs = 0;

	constructor(private readonly cwd: string) {}

	/** What `label`'s config says about each location, then about the files behind each instance. */
	add(
		label: string,
		locations: readonly FileLocation[],
		instances: readonly InstanceLocation[] = []
	): void {
		this.configs++;
		const answer = (location: FileLocation): Answer => ({
			label,
			source: location.source,
			location,
		});
		this.answers.push(
			...locations.map(answer),
			...instances.flatMap(({ reference, files }) =>
				files.length > 0
					? files.map(answer)
					: [{ label, source: reference.text }]
			)
		);
	}

	/** One line per path when every config agrees; otherwise each config's line, headed by its name. Paths keep the order they were first given in, or are sorted. */
	lines(sorted = false): string[] {
		return this.bySource(sorted).flatMap((answers) => {
			const lines = answers.map((answer) => this.describe(answer));
			const agreed =
				answers.length === this.configs &&
				lines.every((line) => line === lines[0]);
			return agreed || this.configs === 1
				? [lines[0]]
				: answers.map(
						({ label }, index) => `${label}: ${lines[index]}`
					);
		});
	}

	/** One entry per config and path, in the order `lines` puts the paths. */
	json(sorted = false): Record<string, unknown>[] {
		return this.bySource(sorted)
			.flat()
			.map(({ label, source, location }) => ({
				config: label,
				...(location
					? {
							source,
							status: location.status,
							...locationFields(location),
						}
					: { instance: source, status: "noFile" }),
			}));
	}

	private bySource(sorted: boolean): Answer[][] {
		const bySource = groupBy(this.answers, ({ source }) => source);
		const sources = [...bySource.keys()];
		if (sorted) sources.sort();
		return sources.map((source) => bySource.get(source) ?? []);
	}

	private describe({ source, location }: Answer): string {
		return location
			? describeLocation(location, this.cwd)
			: `${source} -> no file places it`;
	}
}
