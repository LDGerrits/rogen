import { relativeTo } from "../../base/path.js";
import { configPath } from "../../platform/config/config-path.js";
import { joinedWithAnd, plural } from "../../base/strings.js";
import {
	WriteRun,
	WriteSummary,
	ConfigOutcome,
	isUnchanged,
} from "../../domain/write/write.js";
import { diagnosticGroups } from "../../domain/write/diagnostic-groups.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { RojoRunOutcome } from "../../domain/runner/rojo-command-service.js";
import { ServerMessage } from "../../domain/runner/rojo-server.js";
import {
	reportRojo,
	reportRojoBesideFailure,
	rojoDone,
} from "./report-rojo.js";
import { RojoTarget } from "./rojo-entry.js";

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

export interface RojoDone {
	readonly said: string;
	readonly failed: boolean;
}

export class OutcomeLog {
	constructor(
		private readonly cwd: string,
		@LogService private readonly logService: LogService
	) {}

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

	outcomes(run: WriteRun, home: string | undefined, command: string): void {
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
				(isUnchanged(outcome) || outcome.kind === "wouldWrite") &&
				diagnostics.length === 0 &&
				notes.every((note) => note === undefined);
			if (framed) {
				const label = configPath(this.cwd, outcome.file);
				if (quiet) this.logService.debug(label);
				else this.heading(label);
			}
			this.outcome(outcome, diagnostics, {
				notes,
				quiet: quiet || outcome.kind === "wouldWrite",
			});
		}
	}

	rojoRun(
		{ home, project, written, ran, rojoFailure }: RojoRunOutcome,
		target: RojoTarget,
		{
			prints = false,
			shown = (messages) => messages,
		}: {
			readonly prints?: boolean;
			readonly shown?: (
				messages: readonly ServerMessage[]
			) => readonly ServerMessage[];
		} = {}
	): void {
		const { command } = target;
		this.outcomes(written, home, command);
		if (ran?.isOk())
			(rojoFailure ? reportRojoBesideFailure : reportRojo)(
				this.logService,
				shown(ran.value.messages),
				this.cwd
			);
		if (project === undefined || !prints)
			this.close(written, command, true, {
				said: rojoDone(target, this.cwd),
				failed: rojoFailure !== undefined,
			});
	}

	close(
		run: WriteRun,
		command: string,
		writes: boolean,
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
			readonly quiet?: boolean;
		} = {}
	): void {
		const said = notes.filter((part) => part !== undefined);
		const file = relativeTo(
			this.cwd,
			outcome.kind === "notLoaded"
				? outcome.file
				: outcome.config.projectFile
		);
		const line = (state: string) => [file, state, ...said].join(" · ");
		switch (outcome.kind) {
			case "wrote":
				this.logService.success(
					said.length > 0
						? `Wrote ${file} (${said.join(", ")}).`
						: `Wrote ${file}.`
				);
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

	diagnostics(diagnostics: readonly Diagnostic[], file: string): void {
		this.logService.diagnostics(diagnostics, {
			present: (found) => diagnosticGroups(found, file),
		});
	}

	end(said: string, warnings: number): void {
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
