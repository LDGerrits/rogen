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

/** What one config says about a path: where it lands, and the diagnostics a build raises about it. */
export interface FileAnswer {
	readonly kind: "file";
	readonly label: string;
	readonly location: FileLocation;
	/** The instance it was asked about by, when an instance and not its path asked. */
	readonly instance?: string;
	readonly diagnostics: readonly Diagnostic[];
}

/** What one config says about an instance no file places. */
export interface InstanceAnswer {
	readonly kind: "instance";
	readonly label: string;
	readonly instance: string;
	/** Absolute POSIX folders a new file for it goes in. */
	readonly folders: readonly string[];
	/** Renames of files that would place it. */
	readonly fixes: readonly InstanceFix[];
}

/** What one config says: where a path lands, or that no file places an instance. */
export type Answer = FileAnswer | InstanceAnswer;

const sourceOf = (answer: Answer): string =>
	answer.kind === "file" ? answer.location.source : answer.instance;

/** What the configs answered to a `where`, grouped by the path or instance asked about. */
export class WhereAnswers {
	/** Why the configs that didn't load did not answer. */
	readonly errors: readonly Diagnostic[];
	readonly configCount: number;
	readonly sourcePaths: readonly string[];
	private readonly answers: Answer[];
	/** Every file was asked about, so paths are sorted rather than kept in the order given. */
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

	/** The answers to each path or instance, in the order they were asked, or sorted. A directory's files stay together, in the order its config listed them, and a config answers a file once. */
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

	/** The position of the first thing asked about that this answer is for; after all of them when it is for none. */
	private readonly askedAt = (answer: Answer): number => {
		const at = this.asked.findIndex((entry) =>
			"instance" in entry
				? entry.instance === answer.instance
				: answer.kind === "file" &&
					containsPath(entry.path, answer.location.source)
		);
		return at === -1 ? this.asked.length : at;
	};

	/** `answers` without the ones that say a path is outside a config's source paths, which is no news when another config places it; all of them when every config says so. */
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

/** What one config says about each location, then about the files behind each instance. */
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
