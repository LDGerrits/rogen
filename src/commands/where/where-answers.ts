import { groupBy } from "../../base/collections.js";
import { containsPath } from "../../base/path.js";
import {
	Asked,
	ConfigLocations,
	FileLocation,
	InstanceFix,
	Locations,
	diagnosticsOf,
} from "../../domain/build/build-service.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";

interface FileAnswer {
	readonly kind: "file";
	readonly label: string;
	readonly location: FileLocation;
	readonly instance?: string;
	readonly diagnostics: readonly Diagnostic[];
}

interface InstanceAnswer {
	readonly kind: "instance";
	readonly label: string;
	readonly instance: string;
	readonly folders: readonly string[];
	readonly fixes: readonly InstanceFix[];
}

export type Answer = FileAnswer | InstanceAnswer;

const sourceOf = (answer: Answer): string =>
	answer.kind === "file" ? answer.location.source : answer.instance;

export class WhereAnswers {
	readonly errors: readonly Diagnostic[];
	readonly configCount: number;
	readonly sourcePaths: readonly string[];
	private readonly answers: Answer[];
	private readonly sorted: boolean;
	private readonly asked: readonly Asked[];

	constructor({ everyFile, asked, configs, errors }: Locations) {
		this.errors = errors;
		this.asked = asked;
		this.sourcePaths = configs.flatMap(({ config }) => config.sourcePaths);
		this.configCount = configs.length;
		this.sorted = everyFile;
		this.answers = configs.flatMap((located) => answersOf(located));
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
				({ label }, at, all) =>
					all.findIndex((other) => other.label === label) === at
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

function answersOf({
	config,
	files: locations,
	instances,
	diagnostics,
}: ConfigLocations): Answer[] {
	const { label } = config;
	const answer = (location: FileLocation, instance?: string): FileAnswer => ({
		kind: "file",
		label,
		location,
		...(instance !== undefined && { instance }),
		diagnostics: diagnosticsOf(location, diagnostics),
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
								label,
								instance: reference.text,
								folders,
								fixes,
							},
						]
		),
	];
}
