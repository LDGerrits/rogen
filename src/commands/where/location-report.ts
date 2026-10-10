import { groupBy } from "../../base/collections.js";
import { unescapedGlob } from "../../base/glob.js";
import path from "path";
import { relativeTo, toNative, toPosix } from "../../base/path.js";
import {
	ConfigLocations,
	FileLocation,
	InstanceFix,
	Locations,
	requireOf,
	requirementOf,
} from "../../domain/build/build-service.js";
import { instanceKey } from "../../domain/rojo/rojo-project.js";
import {
	Diagnostic,
	DiagnosticJson,
	diagnosticSummary,
	diagnosticsAbout,
	diagnosticToJson,
	fixToJson,
} from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** The mode a config built in, and every mode it declares. */
interface ModeContext {
	readonly active: string | undefined;
	readonly names: ReadonlySet<string>;
}

/** What one config says: where a path lands, or that no file places an instance. A location also holds the diagnostics a build raises about its path. */
type Answer =
	| {
			readonly kind: "file";
			readonly label: string;
			readonly location: FileLocation;
			readonly mode: ModeContext;
			readonly diagnostics: readonly Diagnostic[];
	  }
	| {
			readonly kind: "instance";
			readonly label: string;
			readonly instance: string;
			/** Absolute POSIX folders a new file for it goes in. */
			readonly folders: readonly string[];
			/** Renames of files that would place it. */
			readonly fixes: readonly InstanceFix[];
	  };

const sourceOf = (answer: Answer): string =>
	answer.kind === "file" ? answer.location.source : answer.instance;

/** A glob that exclusion matched, from `cwd`; it keeps its slashes, which path.relative would turn into backslashes on Windows, and a glob of Rogen's own has no folder to be relative to. */
function patternRelativeTo(cwd: string, escaped: string): string {
	const pattern = unescapedGlob(escaped);
	if (!/^([A-Za-z]:)?\//.test(pattern)) return pattern;
	const rooted = (posixPath: string) =>
		posixPath.startsWith("/") ? posixPath : `/${posixPath}`;
	return path.posix.relative(rooted(toPosix(cwd)), rooted(pattern)) || ".";
}

/** One line: the path, where it lands, and why. */
function describeLocation(
	location: FileLocation,
	mode: ModeContext,
	cwd: string
): string {
	const relative = (file: string) => relativeTo(cwd, file);
	return `${relative(location.source)} -> ${outcomeOf(location, mode, cwd)}`;
}

/** The variants and modes a file carries, as `variants mock (suffix)`, or with each named when both kinds are there. */
function carried(
	matches: readonly { variant: string; form: string }[],
	mode: ModeContext
): string {
	if (matches.length === 0) return "";
	const kindOf = ({ variant }: { variant: string }) =>
		mode.names.has(variant) ? "mode" : "variant";
	const kinds = new Set(matches.map(kindOf));
	const listed = matches.map(({ variant, form }) => `${variant} (${form})`);
	if (kinds.size === 1) {
		const [kind] = kinds;
		return ` · ${kind}${matches.length === 1 ? "" : "s"} ${listed.join(", ")}`;
	}
	return ` · ${matches.map((match, index) => `${kindOf(match)} ${listed[index]}`).join(", ")}`;
}

function outcomeOf(
	location: FileLocation,
	mode: ModeContext,
	cwd: string
): string {
	const relative = (file: string) => relativeTo(cwd, file);
	switch (location.status) {
		case "placed": {
			const variants = carried(location.variants, mode);
			const alsoAt = location.alsoAt
				? ` · also ${location.alsoAt.map(instanceKey).join(", ")}`
				: "";
			const hoisted = location.hoisted ? " · hoisted by ^" : "";
			return `${instanceKey(location.instancePath)} · route ${location.route} (${location.routeMatch})${variants}${hoisted}${alsoAt}`;
		}
		case "pruned": {
			const [first] = location.variants;
			return mode.names.has(first.variant)
				? `pruned · mode is ${mode.active}, not ${first.variant}`
				: `pruned · variant ${first.variant} is off (${first.form})`;
		}
		case "replaced":
			return `replaced by ${relative(location.by)}`;
		case "displaced":
			return `displaced · the template defines ${instanceKey(location.node)}`;
		case "unrouted":
			return "unrouted · no route matches it";
		case "mounted":
			return `mounted · the template mounts it at ${instanceKey(location.node)}`;
		case "excluded":
			return `excluded · matches ${patternRelativeTo(cwd, location.pattern)}`;
		case "skipped":
			return "skipped · the link loops or points at nothing";
		case "outside":
			return "outside the root dirs";
		case "ignored":
			return "not an instance";
		case "missing":
			return location.folder
				? "does not exist · name a file in it to see where it would land"
				: "does not exist";
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
				...(requireOf(location) && { require: requireOf(location) }),
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
			return { pattern: unescapedGlob(location.pattern) };
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
	answer.kind === "file" && answer.location.status === "outside";

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
	private readonly rootDirs: readonly string[];
	/** Every file was asked about, so paths are sorted rather than kept in the order given. */
	private readonly sorted: boolean;

	constructor(
		private readonly cwd: string,
		{ everyFile, configs, errors }: Locations
	) {
		this.errors = errors;
		this.rootDirs = configs.flatMap(({ config }) => config.rootDirs);
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
		const mode: ModeContext = {
			active: config.mode,
			names: new Set(config.modes),
		};
		const answer = (location: FileLocation): Answer => ({
			kind: "file",
			label,
			location,
			mode,
			diagnostics: diagnosticsAbout(diagnostics, location.source),
		});
		return [
			...locations.map(answer),
			...instances.flatMap(
				({ reference, files, folders, fixes }): Answer[] =>
					files.length > 0
						? files.map(answer)
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

	/** One line per path when every config agrees; otherwise each config's line, headed by its name. Under each, a line for every diagnostic a build raises about the path. An `outside` answer counts only when every config gives it. Paths keep the order they were first given in, or are sorted. */
	lines(): string[] {
		return this.blocks().flatMap(({ lines }) => lines);
	}

	/** The lines of each path; under a file the user named, how to require it or why that can't be. For a listing, the expressions that require its modules, which a person only asks to see. */
	blocks(): {
		lines: string[];
		requireLines: string[];
		requires: string[];
	}[] {
		return this.bySource().map((all) => {
			const answers = withoutOutside(all);
			const lines = answers.map((answer) => this.describe(answer));
			const agreed =
				answers.length === this.configs &&
				lines.every((line) => line === lines[0]);
			const requires = [
				...new Set(
					answers.flatMap((answer) =>
						answer.kind === "file"
							? (requireOf(answer.location) ?? [])
							: []
					)
				),
			];
			const requirements = answers.map((answer) =>
				answer.kind === "file"
					? requirementOf(answer.location)
					: undefined
			);
			if (agreed || this.configs === 1)
				return {
					lines: [lines[0], ...this.sharedNotes(answers)],
					requireLines: [
						...new Set(
							requirements.filter((line) => line !== undefined)
						),
					].map((line) => `  ${line}`),
					requires,
				};
			return {
				lines: answers.flatMap((answer, index) => [
					`${answer.label}: ${lines[index]}`,
					...this.noted(answer),
				]),
				requireLines: answers.flatMap(({ label }, index) =>
					requirements[index] === undefined
						? []
						: [`  ${label}: ${requirements[index]}`]
				),
				requires,
			};
		});
	}

	/** Prints the lines of each path, with how to require a file the user named; for a listing, the requires show only with `verbose`. */
	print(logService: LogService, verbose: boolean): void {
		const blocks = this.blocks();
		if (blocks.length === 0) {
			const empty = this.emptyLine();
			if (empty) logService.print(empty);
			return;
		}
		for (const block of blocks) {
			logService.print(block.lines.join("\n"));
			if (block.requireLines.length > 0)
				logService.note(block.requireLines.join("\n"));
			else if (verbose)
				for (const expression of block.requires)
					logService.debug(`require: ${expression}`);
		}
	}

	/** What to say when there is nothing to list because no root dir holds a file; `undefined` when no config answered at all. */
	emptyLine(): string | undefined {
		const rootDirs = [
			...new Set(
				this.rootDirs.map((rootDir) => relativeTo(this.cwd, rootDir))
			),
		];
		return rootDirs.length > 0
			? `No files in the root dirs (${rootDirs.join(", ")}).`
			: undefined;
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
				...(answer.kind === "file" && answer.mode.active
					? { mode: answer.mode.active }
					: {}),
				...(answer.kind === "file"
					? {
							source: toNative(answer.location.source),
							status: answer.location.status,
							exists: answer.location.exists,
							...locationFields(answer.location),
							diagnostics:
								answer.diagnostics.map(diagnosticToJson),
						}
					: {
							instance: answer.instance,
							status: "noFile",
							...(answer.folders.length > 0 && {
								folders: answer.folders.map((folder) =>
									toNative(folder)
								),
							}),
							...(answer.fixes.length > 0 && {
								fixes: answer.fixes.map(({ rename }) =>
									fixToJson({ rename })
								),
							}),
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
		if (answer.kind !== "file") return [];
		return answer.diagnostics.map(
			(diagnostic) => `  ${diagnosticSummary(diagnostic, this.cwd)}`
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

	/** The renames that would place the instance and where a new file for it goes, as the end of its line. */
	private whereToAdd(
		folders: readonly string[],
		fixes: readonly InstanceFix[]
	): string {
		const renames = fixes.map(
			({ code, rename }) =>
				` · ${relativeTo(this.cwd, rename.from)} would, renamed to ${
					path.posix.dirname(toPosix(rename.from)) ===
					path.posix.dirname(toPosix(rename.to))
						? path.posix.basename(toPosix(rename.to))
						: relativeTo(this.cwd, rename.to)
				} (${code})`
		);
		const added =
			folders.length > 0
				? ` · a new file goes in ${folders.map((folder) => `${relativeTo(this.cwd, folder)}/`).join(" or ")}`
				: "";
		return renames.join("") + added;
	}

	private describe(answer: Answer): string {
		return answer.kind === "file"
			? describeLocation(answer.location, answer.mode, this.cwd)
			: `${answer.instance} -> no file places it${this.whereToAdd(answer.folders, answer.fixes)}`;
	}
}
