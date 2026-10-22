import { relativeTo } from "../../base/path.js";
import { joinedWithAnd, plural, unlistedNote } from "../../base/strings.js";
import { WHERE_SCRIPTS_RUN } from "../../domain/roblox/roblox.js";
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

/** What heads a run of warnings with one code, and what follows the files it lists. */
interface DiagnosticGroup {
	readonly headline: (count: number) => string;
	readonly tail?: (count: number) => string;
}

const either = (count: number, one: string, many: string) =>
	count === 1 ? one : many;

const GROUPS: Readonly<Record<string, DiagnosticGroup>> = {
	"scan.sourcePathNamedAfterKey": {
		headline: (count) =>
			`${count} source ${either(count, "path is", "paths are")} named after a route key, but routing starts below a source path, so ${either(count, "its name routes", "their names route")} nothing:`,
	},
	"route.strayAt": {
		headline: (count) =>
			`${count} ${either(count, "name has", "names have")} an "@" that routes nowhere, so ${either(count, "it is read as an ordinary name", "they are read as ordinary names")}:`,
	},
	"route.dotRoute": {
		headline: (count) =>
			`${count} ${either(count, "name writes", "names write")} a route key after a dot, where only "@" routes, so ${either(count, "it routes", "they route")} nothing:`,
	},
	"route.folderTypo": {
		headline: (count) =>
			`${count} ${either(count, "folder is", "folders are")} one edit from a declared route key, so ${either(count, "it is read as an ordinary folder", "they are read as ordinary folders")}:`,
		tail: () =>
			"Rename a folder to the route key if it should route; a folder named as it is stays an ordinary folder.",
	},
	"route.serverCodeShipped": {
		headline: (count) =>
			`${count} ${either(count, "file", "files")} under a server-only route ${either(count, "ships", "ship")} to clients, because an outer route governs ${either(count, "it", "them")}:`,
	},
	"tree.deadScript": {
		headline: (count) =>
			`${count} ${either(count, "script", "scripts")} will never run where ${either(count, "it lands", "they land")}:`,
		tail: () => WHERE_SCRIPTS_RUN,
	},
	"tree.runContextTarget": {
		headline: (count) =>
			`emitLegacyScripts: false makes ${either(count, "an init script", "init scripts")} in StarterPlayerScripts or StarterCharacterScripts ${either(count, "a Script", "Scripts")} with RunContext Client, because Rojo reads init scripts without sync rules:`,
		tail: () =>
			"Route the folder to another service, or remove emitLegacyScripts from the config.",
	},
	"tree.mountClash": {
		headline: (count) =>
			`${count} ${either(count, "file sits", "files sit")} next to an instance of the same name that a mount of the tree holds, so Rojo builds two of ${either(count, "it", "each")}:`,
		tail: (count) =>
			`Rename one of ${either(count, "them", "each pair")}, or route outside the mounted folder.`,
	},
};

/** One diagnostic, filed under `file`, that heads and lists `run`, a run of diagnostics with the code of `group`. */
function block(
	run: readonly Diagnostic[],
	group: DiagnosticGroup,
	file: string
): Diagnostic {
	const [{ severity, code }] = run;
	const unlisted = run.length - LISTED_PER_CODE;
	return {
		severity,
		code,
		resource: file,
		message: [
			group.headline(run.length),
			...run
				.slice(0, LISTED_PER_CODE)
				.map(({ resource, message }) => `  ${resource} (${message})`),
			...(unlisted > 0 ? [`  ${unlistedNote(unlisted)}`] : []),
			...(group.tail ? [group.tail(run.length)] : []),
		].join("\n"),
	};
}

/** The diagnostics as printed: each run of consecutive ones with a code in `GROUPS` becomes one block. */
function grouped(
	diagnostics: readonly Diagnostic[],
	file: string
): Diagnostic[] {
	const printed: Diagnostic[] = [];
	for (let start = 0; start < diagnostics.length;) {
		const { code } = diagnostics[start];
		let end = start + 1;
		while (end < diagnostics.length && diagnostics[end].code === code)
			end++;
		const group = GROUPS[code];
		printed.push(
			...(group
				? [block(diagnostics.slice(start, end), group, file)]
				: diagnostics.slice(start, end))
		);
		start = end;
	}
	return printed;
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
			return [diagnostic];
		const { code } = diagnostic;
		const position = (seen.get(code) ?? 0) + 1;
		seen.set(code, position);
		if (position > LISTED_PER_CODE) return [];
		const unlisted = (totals.get(code) ?? 0) - LISTED_PER_CODE;
		return position === LISTED_PER_CODE && unlisted > 0
			? [noted(diagnostic, unlistedNote(unlisted))]
			: [diagnostic];
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

	/** With `writes` false, the run only checked: a config that built is reported as checked, not as an error. */
	report(
		run: BuildRun,
		home?: string,
		command = "build",
		writes = true
	): void {
		this.begin(
			command,
			run.builds.map(({ label }) => label),
			home
		);
		for (const { build, warnings, errors } of run.shares) {
			if (run.builds.length > 1) this.heading(build.label);
			this.outcome(build, [...warnings.fresh, ...errors.fresh], {
				checked:
					!writes &&
					build.outcome === "notWritten" &&
					build.blockedBy.length === 0,
				notes: [
					build.outcome === "notWritten" && build.blockedBy.length > 0
						? `${joinedWithAnd(build.blockedBy)} failed`
						: undefined,
					BuildLog.sameAs("errors", errors.sameAs),
					BuildLog.sameAs("warnings", warnings.sameAs),
				],
			});
		}
		if (run.failed) this.logService.closeFrame("build failed.");
		else this.end(run.builds.length, run.warningCount, writes);
	}

	private heading(label: string): void {
		this.logService.step(label);
	}

	outcome(
		build: ConfigBuild,
		diagnostics: readonly Diagnostic[],
		{
			notes = [],
			checked = false,
		}: {
			readonly notes?: readonly (string | undefined)[];
			readonly checked?: boolean;
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
				if (checked) this.logService.success(line("checked"));
				else this.logService.error(line("not written"));
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
		this.diagnostics(diagnostics, build.file);
	}

	/** Prints what the build of the config at `file` found, filing a grouped block under it. */
	diagnostics(diagnostics: readonly Diagnostic[], file: string): void {
		for (const diagnostic of diagnostics)
			this.logService.annotate(diagnostic);
		for (const diagnostic of capped(grouped(diagnostics, file)))
			this.logService.diagnostic(diagnostic);
	}

	private end(projects: number, warnings: number, writes: boolean): void {
		const built = `${writes ? "Built" : "Checked"} ${plural(projects, "project")}`;
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
