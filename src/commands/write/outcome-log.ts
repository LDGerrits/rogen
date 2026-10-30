import { relativeTo } from "../../base/path.js";
import { configPath } from "../../platform/config/config-path.js";
import { joinedWithAnd, plural, unlistedNote } from "../../base/strings.js";
import { WHERE_SCRIPTS_RUN } from "../../domain/roblox/roblox.js";
import {
	WriteRun,
	WriteSummary,
	ConfigOutcome,
} from "../../domain/write/write.js";
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
			`${plural(count, "file")} under a server-only route ${either(count, "ships", "ship")} to clients, because an outer route governs ${either(count, "it", "them")}:`,
	},
	"tree.deadScript": {
		headline: (count) =>
			`${plural(count, "script")} will never run where ${either(count, "it lands", "they land")}:`,
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

function describeSummary(summary: WriteSummary, cwd: string): string[] {
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

/** What the Rojo run after the write did, for the closing line. */
export interface RojoDone {
	/** The closing line without its warnings, such as `Built game.rbxl`. */
	readonly said: string;
	/** Whether Rojo failed, so there is nothing to claim. */
	readonly failed: boolean;
}

export class OutcomeLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	/** The note that a config's `kind` are the ones the configs at `files` raised. */
	sameAs(
		kind: "errors" | "warnings",
		files: readonly string[]
	): string | undefined {
		return files.length > 0
			? `same ${kind} as ${joinedWithAnd(files.map((file) => configPath(this.cwd, file)))}`
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

	/** With `writes` false, the run only checked: a config that prepared is reported as one that would be written. */
	report(
		run: WriteRun,
		home?: string,
		command = "build",
		writes = true,
		done?: RojoDone
	): void {
		this.outcomes(run, home, command);
		this.close(run, command, writes, done);
	}

	/** What the write said before Rojo runs: for one config only a project file it wrote and what went wrong, the rest under `-v`; for several, a frame with a line for each. */
	outcomes(run: WriteRun, home?: string, command = "build"): void {
		const framed = run.outcomes.length > 1;
		if (framed)
			this.begin(
				command,
				run.outcomes.map(({ file }) => configPath(this.cwd, file)),
				home
			);
		else
			this.logService.debug(
				[
					`rogen ${command}`,
					...run.outcomes.map(({ file }) =>
						configPath(this.cwd, file)
					),
					inFolder(this.cwd, home),
				]
					.filter((part) => part !== undefined)
					.join(" · ")
			);
		for (const { outcome, warnings, errors } of run.shares) {
			const diagnostics = [...warnings.fresh, ...errors.fresh];
			const notes = [
				outcome.kind === "notWritten"
					? `${joinedWithAnd(
							outcome.blockedBy.map((file) =>
								configPath(this.cwd, file)
							)
						)} failed`
					: undefined,
				this.sameAs("errors", errors.sameAs),
				this.sameAs("warnings", warnings.sameAs),
			];
			const quiet =
				(outcome.kind === "unchanged" ||
					outcome.kind === "wouldWrite") &&
				diagnostics.length === 0 &&
				notes.every((note) => note === undefined);
			if (framed) {
				const label = configPath(this.cwd, outcome.file);
				if (quiet) this.logService.debug(label);
				else this.heading(label);
			}
			if (!framed && outcome.kind === "wrote") {
				this.logService.success(
					`Wrote ${relativeTo(this.cwd, outcome.config.projectFile)}.`
				);
				this.details(outcome.summary);
				this.diagnostics(diagnostics, outcome.file);
			} else
				this.outcome(outcome, diagnostics, {
					notes,
					quiet: quiet || outcome.kind === "wouldWrite",
				});
		}
	}

	/** The closing line: what Rojo did, else how many configs the run wrote; nothing after a failure, or for one config with nothing to claim. */
	close(
		run: WriteRun,
		command = "build",
		writes = true,
		done?: RojoDone
	): void {
		if (run.outcomes.length > 1) {
			if (run.failed || done?.failed)
				this.logService.closeFrame(
					run.failed ? "write failed." : `${command} failed.`
				);
			else
				this.end(
					done?.said ??
						`${writes ? "Wrote" : "Checked"} ${plural(run.outcomes.length, "project")}`,
					run.warningCount
				);
		} else if (!run.failed && done && !done.failed)
			this.end(done.said, run.warningCount);
	}

	private heading(label: string): void {
		this.logService.step(label);
	}

	outcome(
		outcome: ConfigOutcome,
		diagnostics: readonly Diagnostic[],
		{
			notes = [],
			quiet = false,
		}: {
			readonly notes?: readonly (string | undefined)[];
			/** Whether a project file left as it was, or only checked, is said only under `-v`. */
			readonly quiet?: boolean;
		} = {}
	): void {
		const note =
			notes.filter((part) => part !== undefined).join(" · ") || undefined;
		const line = (said: string) =>
			[
				relativeTo(
					this.cwd,
					outcome.kind === "notLoaded"
						? outcome.file
						: outcome.config.projectFile
				),
				said,
				note,
			]
				.filter((part) => part !== undefined)
				.join(" · ");
		switch (outcome.kind) {
			case "wrote":
				this.logService.success(line(outcome.kind));
				this.details(outcome.summary);
				break;
			case "unchanged":
				if (quiet) this.logService.debug(line(outcome.kind));
				else this.logService.success(line(outcome.kind));
				this.details(outcome.summary);
				break;
			case "wouldWrite":
				if (quiet) this.logService.debug(line("checked"));
				else this.logService.success(line("would write"));
				this.details(outcome.summary);
				break;
			case "notWritten":
				this.logService.error(line("not written"));
				this.details(outcome.summary);
				break;
			case "failed":
				this.logService.error(line("not written"));
				this.details();
				break;
			case "notLoaded":
				this.logService.error(line("not loaded"));
				break;
		}
		this.diagnostics(diagnostics, outcome.file);
	}

	/** Prints what the write of the config at `file` found, filing a grouped block under it. */
	diagnostics(diagnostics: readonly Diagnostic[], file: string): void {
		for (const diagnostic of diagnostics)
			this.logService.annotate(diagnostic);
		for (const diagnostic of capped(grouped(diagnostics, file)))
			this.logService.diagnostic(diagnostic);
	}

	private end(said: string, warnings: number): void {
		this.logService.outro(
			warnings === 0
				? `${said}.`
				: `${said} with ${plural(warnings, "warning")}.`
		);
	}

	private details(summary?: WriteSummary): void {
		for (const line of summary ? describeSummary(summary, this.cwd) : [])
			this.logService.debug(line);
	}
}
