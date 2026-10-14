import { relativeTo } from "../../base/path.js";
import { joinedWithAnd, plural, unlistedNote } from "../../base/strings.js";
import {
	BuildRun,
	BuildSummary,
	ConfigBuild,
} from "../../domain/build/build.js";
import {
	Diagnostic,
	DiagnosticSeverity,
} from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

const LISTED_PER_CODE = 10;

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

const noted = (diagnostic: Diagnostic, note: string): Diagnostic => ({
	...diagnostic,
	message: `${diagnostic.message} ${note}`,
});

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
			? [noted(withListCapped(diagnostic), unlistedNote(unlisted))]
			: [withListCapped(diagnostic)];
	});
}

function describeBuild(summary: BuildSummary, cwd: string): string[] {
	const roots = summary.roots.map(
		({ sourcePath, files, ignored, mounted, skippedLinks }) =>
			[
				`${relativeTo(cwd, sourcePath)}: ${plural(files, "file")}`,
				...(ignored > 0 ? [`${ignored} ignored`] : []),
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
	const leftOut = [
		...(summary.unrouted > 0 ? [`${summary.unrouted} unrouted`] : []),
		...(summary.replaced > 0
			? [`${summary.replaced} replaced by a file with the same name`]
			: []),
		...(summary.displaced > 0
			? [`${summary.displaced} displaced by the tree`]
			: []),
	];
	return [
		...roots,
		...routes,
		...(leftOut.length > 0 ? [`left out: ${leftOut.join(", ")}`] : []),
	];
}

function inFolder(cwd: string, home: string | undefined): string | undefined {
	return home === undefined || relativeTo(cwd, home) === "."
		? undefined
		: `in ${relativeTo(cwd, home)}`;
}

export class BuildLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	static sameAs(
		kind: "errors" | "warnings",
		labels: readonly string[]
	): string | undefined {
		return labels.length > 0
			? `same ${kind} as ${joinedWithAnd(labels)}`
			: undefined;
	}

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

	report(run: BuildRun, home?: string, command = "build"): void {
		this.begin(
			command,
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
			});
		}
		if (run.failed) this.logService.closeFrame("build failed.");
		else this.end(run.builds.length, run.warningCount);
	}

	private heading(label: string): void {
		this.logService.step(label);
	}

	outcome(
		build: ConfigBuild,
		diagnostics: readonly Diagnostic[],
		{
			notes = [],
		}: {
			readonly notes?: readonly (string | undefined)[];
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
						: build.config.projectFile
				),
				outcome,
				note,
			]
				.filter((part) => part !== undefined)
				.join(" · ");
		switch (build.outcome) {
			case "wrote":
			case "unchanged":
				this.logService.success(line(build.outcome));
				this.details(build.summary);
				break;
			case "notWritten":
				this.logService.error(line("not written"));
				this.details(build.summary);
				break;
			case "failed":
				this.logService.error(line("not written"));
				this.details();
				break;
			case "notLoaded":
				this.logService.error(line("not loaded"));
				break;
		}
		this.diagnostics(diagnostics);
	}

	diagnostics(diagnostics: readonly Diagnostic[]): void {
		for (const diagnostic of diagnostics)
			this.logService.annotate(diagnostic);
		for (const diagnostic of capped(diagnostics))
			this.logService.diagnostic(diagnostic);
	}

	private end(configs: number, warnings: number): void {
		const built = `Built ${plural(configs, "config")}`;
		this.logService.outro(
			warnings === 0
				? `${built}.`
				: `${built} with ${plural(warnings, "warning")}.`
		);
	}

	private details(summary?: BuildSummary): void {
		for (const line of summary ? describeBuild(summary, this.cwd) : [])
			this.logService.debug(line);
	}
}
