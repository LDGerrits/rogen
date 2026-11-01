import { groupBy } from "../../base/collections.js";
import { containsPath } from "../../base/path.js";
import {
	Asked,
	ConfigLocations,
	FileLocation,
	InstanceFix,
	Locations,
	diagnosticsOf,
} from "../../domain/write/write-service.js";
import {
	Diagnostic,
	isError,
	newDiagnostics,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";

interface FileAnswer {
	readonly kind: "file";
	/** The config file that answered. */
	readonly config: string;
	readonly location: FileLocation;
	readonly instance?: string;
	readonly diagnostics: readonly Diagnostic[];
}

interface InstanceAnswer {
	readonly kind: "instance";
	readonly config: string;
	readonly instance: string;
	readonly folders: readonly string[];
	readonly fixes: readonly InstanceFix[];
}

export type Answer = FileAnswer | InstanceAnswer;

const sourceOf = (answer: Answer): string =>
	answer.kind === "file" ? answer.location.source : answer.instance;

export class WhereAnswers {
	/** The errors no answer shows: why a config didn't load, and what stops a write that no line is about or says is blocked. */
	readonly errors: readonly Diagnostic[];
	/** The errors that stop the write of a config that answered. */
	readonly stops: readonly Diagnostic[];
	readonly configCount: number;
	readonly sourcePaths: readonly string[];
	private readonly answers: Answer[];
	private readonly sorted: boolean;
	private readonly asked: readonly Asked[];

	constructor({ everyFile, asked, configs, errors }: Locations) {
		this.asked = asked;
		this.sourcePaths = configs.flatMap(({ config }) => config.sourcePaths);
		this.configCount = configs.length;
		this.sorted = everyFile;
		this.answers = configs.flatMap((located) => answersOf(located));
		this.stops = uniqueDiagnostics(
			configs.flatMap(({ diagnostics }) => diagnostics.filter(isError))
		);
		const shown = this.answers.flatMap((answer) =>
			answer.kind === "file" ? answer.diagnostics : []
		);
		const unblocked = configs.filter(
			({ files }) => !files.some(({ status }) => status === "blocked")
		);
		this.errors = uniqueDiagnostics([
			...errors,
			...newDiagnostics(
				shown,
				unblocked.flatMap(({ diagnostics }) =>
					diagnostics.filter(isError)
				)
			),
		]);
	}

	/** In the order asked, or sorted; a directory's files stay together. */
	bySource(): Answer[][] {
		const bySource = groupBy(this.answers, sourceOf);
		const sources = [...bySource.keys()];
		if (this.sorted) sources.sort();
		else if (this.asked.length > 1) {
			const rank = new Map(
				sources.map((source) => [
					source,
					Math.min(...(bySource.get(source) ?? []).map(this.askedAt)),
				])
			);
			sources.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
		}
		return sources.map((source) =>
			(bySource.get(source) ?? []).filter(
				({ config }, at, all) =>
					all.findIndex((other) => other.config === config) === at
			)
		);
	}

	private readonly askedAt = (answer: Answer): number => {
		const at = this.asked.findIndex((entry) =>
			"instance" in entry
				? entry.instance === answer.instance
				: answer.kind === "file" &&
					containsPath(entry.path, answer.location.source)
		);
		return at === -1 ? this.asked.length : at;
	};

	/** For each instance asked about that a file places: the answers that place it, by file. */
	byInstance(): Map<string, Map<string, FileAnswer[]>> {
		const placing = this.answers.filter(
			(answer): answer is FileAnswer & { readonly instance: string } =>
				answer.kind === "file" && answer.instance !== undefined
		);
		return new Map(
			[...groupBy(placing, ({ instance }) => instance)].map(
				([instance, all]) => [
					instance,
					groupBy(all, ({ location }) => location.source),
				]
			)
		);
	}

	static withoutOutside(answers: readonly Answer[]): readonly Answer[] {
		const inside = answers.filter(
			(answer) =>
				!(
					answer.kind === "file" &&
					answer.location.status === "outside"
				)
		);
		return inside.length > 0 ? inside : answers;
	}
}

function answersOf(located: ConfigLocations): Answer[] {
	const { config, files: locations, instances } = located;
	const { file } = config;
	const answer = (location: FileLocation, instance?: string): FileAnswer => ({
		kind: "file",
		config: file,
		location,
		...(instance !== undefined && { instance }),
		diagnostics: diagnosticsOf(location, located),
	});
	return [
		...locations.map((location) => answer(location)),
		...instances.flatMap(
			({ reference, files, folders, fixes }): Answer[] =>
				files.length > 0
					? files.map((file) => answer(file, reference.text))
					: [
							{
								kind: "instance",
								config: file,
								instance: reference.text,
								folders,
								fixes,
							},
						]
		),
	];
}
