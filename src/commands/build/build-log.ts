import { relativeTo } from "../../base/path.js";
import { joinedWithAnd, plural, unlistedNote } from "../../base/strings.js";
import {
	BuildRun,
	BuildSummary,
	ConfigBuild,
} from "../../domain/build/build.js";
import { ResolvedConfig } from "../../domain/config/config.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** How many warnings of one code a config prints before the rest are counted. */
const LISTED_PER_CODE = 10;

/** A grouped diagnostic lists each related file on a line of its message after the first; this keeps ten and counts the rest. */
function withListCapped(diagnostic: Diagnostic): Diagnostic {
	const count = diagnostic.related?.length ?? 0;
	if (count <= LISTED_PER_CODE) return diagnostic;
	const [headline, ...lines] = diagnostic.message.split("\n");
	const unlisted = count - LISTED_PER_CODE;
	return {
		...diagnostic,
		message: [
			headline,
			...lines.slice(0, LISTED_PER_CODE),
			`  ${unlistedNote(unlisted)}`,
			...lines.slice(count),
		].join("\n"),
	};
}

/** At most `LISTED_PER_CODE` warnings of one code; the last one printed says how many more there were. Errors always print, since the build stops on them. */
function capped(diagnostics: readonly Diagnostic[]): Diagnostic[] {
	const totals = new Map<string, number>();
	const warnings = diagnostics.filter(
		({ severity }) => severity === DiagnosticSeverity.Warning
	);
	for (const { code } of warnings)
		totals.set(code, (totals.get(code) ?? 0) + 1);
	const seen = new Map<string, number>();
	return diagnostics.flatMap((diagnostic) => {
		if (diagnostic.severity !== DiagnosticSeverity.Warning)
			return [withListCapped(diagnostic)];
		const { code } = diagnostic;
		const position = (seen.get(code) ?? 0) + 1;
		seen.set(code, position);
		if (position > LISTED_PER_CODE) return [];
		const unlisted = (totals.get(code) ?? 0) - LISTED_PER_CODE;
		return position === LISTED_PER_CODE && unlisted > 0
			? [
					{
						...diagnostic,
						message: `${diagnostic.message} ${unlistedNote(unlisted)}`,
					},
				]
			: [withListCapped(diagnostic)];
	});
}

/** The `extends` chain and skipped variant flags of a config. */
function describeConfig(config: ResolvedConfig, cwd: string): string[] {
	const parents = config.parents.map((file) => relativeTo(cwd, file));
	return [
		...(parents.length > 0 ? [`extends: ${parents.join(" -> ")}`] : []),
		...config.skippedVariants.map(
			(variant) =>
				`variant ${variant} skipped: not declared in this config`
		),
	];
}

/** One line per root dir, route and variant. */
function describeBuild(summary: BuildSummary, cwd: string): string[] {
	const roots = summary.roots.map(
		({ rootDir, files, excluded, mounted, skippedLinks }) =>
			[
				`${relativeTo(cwd, rootDir)}: ${plural(files, "file")}`,
				...(excluded > 0 ? [`${excluded} excluded`] : []),
				...(mounted > 0 ? [`${mounted} mounted`] : []),
				...(skippedLinks > 0
					? [plural(skippedLinks, "skipped link")]
					: []),
			].join(", ")
	);
	const routes = summary.routes.map(
		({ key, target, files }) =>
			`route ${key} -> ${target}: ${plural(files, "file")}`
	);
	const switched = (
		kind: string,
		name: string,
		on: boolean,
		files: number
	) =>
		on
			? `${kind} ${name} on: ${plural(files, "file")}`
			: `${kind} ${name} off: ${plural(files, "file")} left out`;
	const variants = summary.variants.map(({ variant, on, files }) =>
		switched("variant", variant, on, files)
	);
	const modes = summary.modes.map(({ mode, on, files }) =>
		switched("mode", mode, on, files)
	);
	const leftOut = [
		...(summary.unrouted > 0 ? [`${summary.unrouted} unrouted`] : []),
		...(summary.replaced > 0
			? [`${summary.replaced} replaced by a file with the same name`]
			: []),
		...(summary.displaced > 0
			? [`${summary.displaced} displaced by the template`]
			: []),
	];
	return [
		...roots,
		...routes,
		...variants,
		...modes,
		...(leftOut.length > 0 ? [`left out: ${leftOut.join(", ")}`] : []),
	];
}

/** `in <folder>`, relative to `cwd`, for a `home` that isn't `cwd` itself. */
function inFolder(cwd: string, home: string | undefined): string | undefined {
	return home === undefined || relativeTo(cwd, home) === "."
		? undefined
		: `in ${relativeTo(cwd, home)}`;
}

/** How `build` and `watch` tell the user what they built, relative to where they run. */
export class BuildLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	/** `same warnings as lobby`, for a config whose diagnostics of `kind` earlier configs all said. */
	static sameAs(
		kind: "errors" | "warnings",
		labels: readonly string[]
	): string | undefined {
		return labels.length > 0
			? `same ${kind} as ${joinedWithAnd(labels)}`
			: undefined;
	}

	/** Opens the output: the command and the configs it builds, and the folder they are in when that isn't the working directory. */
	begin(command: string, labels: readonly string[], home?: string): void {
		this.logService.intro(
			[
				`rogen ${command}`,
				labels.length > 0 ? labels.join(", ") : undefined,
				inFolder(this.cwd, home),
			]
				.filter((part) => part !== undefined)
				.join(" · ")
		);
	}

	/** The whole output of a build: each config's outcome, warnings and errors, then the closing line. An error an earlier config printed is not printed again; the line says so. */
	report(run: BuildRun, home?: string, denyWarnings = false): void {
		this.begin(
			"build",
			run.builds.map(({ label }) => label),
			home
		);
		for (const { build, warnings, errors } of run.shares) {
			if (run.builds.length > 1) this.heading(build.label);
			this.outcome(build, [...warnings.fresh, ...errors.fresh], {
				notes: [
					build.outcome === "notWritten"
						? `${joinedWithAnd(build.blockedBy)} failed`
						: undefined,
					BuildLog.sameAs("errors", errors.sameAs),
					BuildLog.sameAs("warnings", warnings.sameAs),
				],
				failing: denyWarnings,
			});
		}
		if (run.failed) this.logService.closeFrame("build failed.");
		else this.end(run.builds.length, run.warningCount, denyWarnings);
	}

	/** Heads the lines about one config, when a run builds several. */
	private heading(label: string): void {
		this.logService.step(label);
	}

	/** One config's line for what the run did to its project file, ending in the `notes` that apply, then `diagnostics`, which `failing` makes the run fail. */
	outcome(
		build: ConfigBuild,
		diagnostics: readonly Diagnostic[],
		{
			notes = [],
			failing = false,
		}: {
			readonly notes?: readonly (string | undefined)[];
			readonly failing?: boolean;
		} = {}
	): void {
		const note =
			notes.filter((part) => part !== undefined).join(" · ") || undefined;
		const line = (outcome: string) =>
			[
				relativeTo(
					this.cwd,
					build.outcome === "notLoaded"
						? build.file
						: build.config.outFile
				),
				outcome,
				build.outcome !== "notLoaded" && build.config.mode
					? `mode ${build.config.mode}`
					: undefined,
				note,
			]
				.filter((part) => part !== undefined)
				.join(" · ");
		switch (build.outcome) {
			case "wrote":
			case "unchanged":
				this.logService.success(line(build.outcome));
				this.details(build.config, build.summary);
				break;
			case "notWritten":
				this.logService.error(line("not written"));
				this.details(build.config, build.summary);
				break;
			case "failed":
				this.logService.error(line("not written"));
				this.details(build.config);
				break;
			case "notLoaded":
				this.logService.error(line("not loaded"));
				break;
		}
		this.diagnostics(diagnostics, failing);
	}

	/** `failing` when the diagnostics are what fails the run, as every warning is under `--deny-warnings`. */
	diagnostics(diagnostics: readonly Diagnostic[], failing = false): void {
		for (const diagnostic of capped(diagnostics))
			this.logService.diagnostic(diagnostic, failing);
	}

	/** Closes the output of a build that wrote every config, counting its warnings. */
	private end(
		configs: number,
		warnings: number,
		denyWarnings: boolean
	): void {
		const built = `Built ${plural(configs, "config")}`;
		this.logService.outro(
			warnings === 0
				? `${built}.`
				: `${built} with ${plural(warnings, "warning")}${denyWarnings ? "; --deny-warnings fails the run" : ""}.`
		);
	}

	/** The `--verbose` lines for one config: how it was loaded and, once built, what the build placed. */
	private details(config: ResolvedConfig, summary?: BuildSummary): void {
		for (const line of [
			...describeConfig(config, this.cwd),
			...(summary ? describeBuild(summary, this.cwd) : []),
		])
			this.logService.debug(line);
	}
}
