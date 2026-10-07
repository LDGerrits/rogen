import { groupBy } from "../../base/collections.js";
import path from "path";
import { relativeTo, toNative, toPosix } from "../../base/path.js";
import {
	ConfigLocations,
	FileLocation,
	Locations,
} from "../../domain/build/build.js";
import { instanceKey } from "../../domain/rojo/rojo-project.js";
import {
	Diagnostic,
	DiagnosticJson,
	DiagnosticSeverity,
	diagnosticToJson,
	messageRelativeTo,
} from "../../platform/diagnostics/diagnostic.js";

/** What one config says: where a path lands, or that no file places an instance. A location also holds the diagnostics a build raises about its path. */
type Answer =
	| {
			readonly label: string;
			readonly location: FileLocation;
			readonly diagnostics: readonly Diagnostic[];
	  }
	| { readonly label: string; readonly instance: string };

/** The diagnostics about `source`, each narrowed to it: a grouped one becomes the entry of its `related` that names `source`, with only the fixes that rename it. */
function aboutPath(
	diagnostics: readonly Diagnostic[],
	source: string
): Diagnostic[] {
	const target = toPosix(source);
	return diagnostics.flatMap((diagnostic): Diagnostic[] => {
		const { related, ...rest } = diagnostic;
		const entries = (related ?? []).filter(
			({ resource }) => toPosix(resource) === target
		);
		if (entries.length > 0)
			return entries.map(({ message }) => ({
				...rest,
				resource: source,
				position: undefined,
				message,
				fixes: diagnostic.fixes?.filter(
					({ rename }) => toPosix(rename.from) === target
				),
			}));
		// A group is about its related files; its own resource is the config.
		return !related?.length && toPosix(diagnostic.resource) === target
			? [rest]
			: [];
	});
}

const sourceOf = (answer: Answer): string =>
	"location" in answer ? answer.location.source : answer.instance;

/** One line: the path, where it lands, and why. */
function describeLocation(location: FileLocation, cwd: string): string {
	const relative = (file: string) => relativeTo(cwd, file);
	return `${relative(location.source)} -> ${outcomeOf(location, cwd)}`;
}

function outcomeOf(location: FileLocation, cwd: string): string {
	const relative = (file: string) => relativeTo(cwd, file);
	switch (location.status) {
		case "placed": {
			const matches = location.variants.map(
				({ variant, form }) => `${variant} (${form})`
			);
			const variants =
				matches.length === 0
					? ""
					: ` · ${matches.length === 1 ? "variant" : "variants"} ${matches.join(", ")}`;
			const alsoAt = location.alsoAt
				? ` · also ${location.alsoAt.map(instanceKey).join(", ")}`
				: "";
			const hoisted = location.hoisted ? " · hoisted by ^" : "";
			return `${instanceKey(location.instancePath)} · route ${location.route} (${location.routeMatch})${variants}${hoisted}${alsoAt}`;
		}
		case "pruned":
			return `pruned · variant ${location.variants[0].variant} is off (${location.variants[0].form})`;
		case "replaced":
			return `replaced by ${relative(location.by)}`;
		case "displaced":
			return `displaced · the template defines ${instanceKey(location.node)}`;
		case "unrouted":
			return "unrouted · no route matches it";
		case "mounted":
			return `mounted · the template mounts it at ${instanceKey(location.node)}`;
		case "excluded":
			// A glob keeps its slashes, which path.relative would turn into backslashes on Windows.
			return `excluded · matches ${path.posix.relative(toPosix(cwd), location.pattern) || "."}`;
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
				...(location.alsoAt && { alsoAt: location.alsoAt }),
				route: location.route,
				routeMatch: location.routeMatch,
				variants: location.variants.map(({ variant, form }) => ({
					variant,
					form,
				})),
				...(location.hoisted && { hoisted: true }),
			};
		case "pruned":
			return {
				variants: location.variants.map(({ variant, form }) => ({
					variant,
					form,
				})),
			};
		case "replaced":
			return { by: toNative(location.by) };
		case "displaced":
		case "mounted":
			return { node: location.node };
		case "excluded":
			return { pattern: location.pattern };
		case "unrouted":
		case "skipped":
		case "outside":
		case "ignored":
		case "missing":
		case "empty":
			return {};
	}
}

const isOutside = (answer: Answer): boolean =>
	"location" in answer && answer.location.status === "outside";

/** A path outside one config's root dirs is no news when another config places it. */
function withoutOutside(answers: readonly Answer[]): readonly Answer[] {
	const inside = answers.filter((answer) => !isOutside(answer));
	return inside.length > 0 ? inside : answers;
}

/** Where files land, one line per path however many configs answered. */
export class LocationReport {
	private readonly answers: Answer[];
	/** Why the configs that didn't load did not answer. */
	readonly errors: readonly Diagnostic[];
	private readonly configs: number;
	/** Every file was asked about, so paths are sorted rather than kept in the order given. */
	private readonly sorted: boolean;

	constructor(
		private readonly cwd: string,
		{ everyFile, configs, errors }: Locations
	) {
		this.errors = errors;
		this.configs = configs.length;
		this.sorted = everyFile;
		this.answers = configs.flatMap((located) => this.answersOf(located));
	}

	/** What one config says about each location, then about the files behind each instance. */
	private answersOf({
		config,
		files: locations,
		instances,
		diagnostics,
	}: ConfigLocations): Answer[] {
		const { label } = config;
		const answer = (location: FileLocation): Answer => ({
			label,
			location,
			diagnostics: aboutPath(diagnostics, location.source),
		});
		return [
			...locations.map(answer),
			...instances.flatMap(({ reference, files }) =>
				files.length > 0
					? files.map(answer)
					: [{ label, instance: reference.text }]
			),
		];
	}

	/** One line per path when every config agrees; otherwise each config's line, headed by its name. Under each, a line for every diagnostic a build raises about the path. An `outside` answer counts only when every config gives it. Paths keep the order they were first given in, or are sorted. */
	lines(): string[] {
		return this.bySource().flatMap((all) => {
			const answers = withoutOutside(all);
			const lines = answers.map((answer) => this.describe(answer));
			const agreed =
				answers.length === this.configs &&
				lines.every((line) => line === lines[0]);
			if (agreed || this.configs === 1)
				return [lines[0], ...this.sharedNotes(answers)];
			return answers.flatMap((answer, index) => [
				`${answer.label}: ${lines[index]}`,
				...this.noted(answer),
			]);
		});
	}

	/** One entry per config and path, in the order `lines` puts the paths, under `locations`. */
	json(): {
		locations: Record<string, unknown>[];
		diagnostics: DiagnosticJson[];
	} {
		const locations = this.bySource()
			.flat()
			.map((answer) => ({
				config: answer.label,
				...("location" in answer
					? {
							source: toNative(answer.location.source),
							status: answer.location.status,
							...locationFields(answer.location),
							diagnostics:
								answer.diagnostics.map(diagnosticToJson),
						}
					: {
							instance: answer.instance,
							status: "noFile",
							diagnostics: [],
						}),
			}));
		return {
			locations,
			diagnostics: this.errors.map(diagnosticToJson),
		};
	}

	private bySource(): Answer[][] {
		const bySource = groupBy(this.answers, sourceOf);
		const sources = [...bySource.keys()];
		if (this.sorted) sources.sort();
		return sources.map((source) => bySource.get(source) ?? []);
	}

	/** One indented line for each diagnostic about the answer's path: its severity, what it says about the path and its code, which `rogen help <code>` explains. */
	private noted(answer: Answer): string[] {
		if (!("location" in answer)) return [];
		return answer.diagnostics.map(
			({ severity, message, code }) =>
				`  ${severity === DiagnosticSeverity.Error ? "error" : "warning"}: ${messageRelativeTo(message, this.cwd)} (${code})`
		);
	}

	/** The notes every answer has once, then the ones only some have, headed by their config. */
	private sharedNotes(answers: readonly Answer[]): string[] {
		const notes = answers.map((answer) => this.noted(answer));
		const shared = notes[0].filter((note) =>
			notes.every((own) => own.includes(note))
		);
		return [
			...new Set(shared),
			...answers.flatMap(({ label }, index) =>
				notes[index]
					.filter((note) => !shared.includes(note))
					.map((note) => `  ${label}: ${note.trimStart()}`)
			),
		];
	}

	private describe(answer: Answer): string {
		return "location" in answer
			? describeLocation(answer.location, this.cwd)
			: `${answer.instance} -> no file places it`;
	}
}
