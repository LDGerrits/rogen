import { unescapedGlob } from "../../base/glob.js";
import path from "path";
import { relativeTo, toPosix } from "../../base/path.js";
import {
	FileLocation,
	InstanceFix,
	requireExpressionOf,
	requireNoteOf,
} from "../../domain/build/build-service.js";
import { diagnosticSummary } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { instanceKey } from "../../domain/roblox/roblox.js";
import { Answer, WhereAnswers } from "./where-answers.js";

/** A glob that exclusion matched, from `cwd`; it keeps its slashes, which path.relative would turn into backslashes on Windows, and a glob of Rogen's own has no folder to be relative to. */
function patternRelativeTo(cwd: string, escaped: string): string {
	const pattern = unescapedGlob(escaped);
	if (!/^([A-Za-z]:)?\//.test(pattern)) return pattern;
	const rooted = (posixPath: string) =>
		posixPath.startsWith("/") ? posixPath : `/${posixPath}`;
	return path.posix.relative(rooted(toPosix(cwd)), rooted(pattern)) || ".";
}

/** One line: the path, where it lands, and why. */
function describeLocation(location: FileLocation, cwd: string): string {
	const relative = (file: string) => relativeTo(cwd, file);
	return `${relative(location.source)} -> ${outcomeOf(location, cwd)}`;
}

function outcomeOf(location: FileLocation, cwd: string): string {
	const relative = (file: string) => relativeTo(cwd, file);
	switch (location.status) {
		case "placed": {
			const alsoAt = location.alsoAt
				? ` · also ${location.alsoAt.map(instanceKey).join(", ")}`
				: "";
			const hoisted = location.hoisted ? " · hoisted by ^" : "";
			return `${instanceKey(location.instancePath)} · route ${location.route} (${location.routeMatch})${hoisted}${alsoAt}`;
		}
		case "replaced":
			return `replaced by ${relative(location.by)}`;
		case "displaced":
			return `displaced · the tree defines ${instanceKey(location.node)}`;
		case "unrouted":
			return "unrouted · no route matches it";
		case "mounted":
			return `mounted · the tree mounts it at ${instanceKey(location.node)}`;
		case "ignored":
			return `ignored · matches ${patternRelativeTo(cwd, location.pattern)}`;
		case "skipped":
			return "skipped · the link loops or points at nothing";
		case "extensionCase":
			return "not an instance · its extension is not in lowercase";
		case "blocked":
			return location.own
				? `not placed · it has an error (${location.by.code})`
				: `not placed · the build stops on ${relative(location.by.resource)} (${location.by.code}); run 'rogen check'`;
		case "outside":
			return "outside the source paths";
		case "notInstance":
			return "not an instance";
		case "missing":
			return location.folder
				? "does not exist · name a file in it to see where it would land"
				: "does not exist";
		case "empty":
			return "empty · no file in it places";
	}
}

/** Where files land, one line per path however many configs answered. */
export class WhereLog {
	constructor(
		private readonly cwd: string,
		private readonly answers: WhereAnswers
	) {}

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
		return this.answers.bySource().map((all) => {
			const answers = WhereAnswers.withoutOutside(all);
			const lines = answers.map((answer) => this.describe(answer));
			const agreed =
				new Set(answers.map(({ label }) => label)).size ===
					this.answers.configCount &&
				lines.every((line) => line === lines[0]);
			const requires = [
				...new Set(
					answers.flatMap((answer) =>
						answer.kind === "file"
							? (requireExpressionOf(answer.location) ?? [])
							: []
					)
				),
			];
			const requirements = answers.map((answer) =>
				answer.kind === "file"
					? requireNoteOf(answer.location)
					: undefined
			);
			if (agreed || this.answers.configCount === 1)
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

	/** Prints the lines of each path, with how to require a file the user named; for a listing, the requires are debug lines. */
	print(logService: LogService): void {
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
			else
				for (const expression of block.requires)
					logService.debug(`require: ${expression}`);
		}
	}

	/** What to say when there is nothing to list because no source path holds a file; `undefined` when no config answered at all. */
	emptyLine(): string | undefined {
		const sourcePaths = [
			...new Set(
				this.answers.sourcePaths.map((sourcePath) =>
					relativeTo(this.cwd, sourcePath)
				)
			),
		];
		return sourcePaths.length > 0
			? `No files in the source paths (${sourcePaths.join(", ")}).`
			: undefined;
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
			? describeLocation(answer.location, this.cwd)
			: `${answer.instance} -> no file places it${this.whereToAdd(answer.folders, answer.fixes)}`;
	}
}
