import path from "path";
import { toNative } from "../../base/path.js";
import { Result } from "../../base/result.js";
import { RojoCommandRun } from "../../domain/runner/rojo-command-service.js";
import { ServerMessage } from "../../domain/runner/rojo-server.js";
import {
	DiagnosticJson,
	ErrorJson,
	diagnosticShape,
	errorShape,
	failureToJson,
} from "../../platform/diagnostics/diagnostic-json.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { messageRelativeTo } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** One thing Rojo said, at the level it said it. */
function reportServerMessage(
	logService: LogService,
	{ severity, text }: ServerMessage,
	cwd: string
): void {
	if (severity === "debug") {
		logService.debug(`Rojo: ${text}`);
		return;
	}
	const said = `Rojo: ${messageRelativeTo(text, cwd)}`;
	if (severity === "error") logService.error(said);
	else if (severity === "warning") logService.warn(said);
	else logService.info(said);
}

/** A line Rojo printed on stdout comes out on stdout as it printed it, so a program that reads its output reads Rogen's; in a frame it is an `info` line, or `debug` when Rogen drops it as noise, so the frame stays whole. */
export function reportServerOutput(
	logService: LogService,
	message: ServerMessage,
	cwd: string
): void {
	if (!logService.framed && message.stdout !== undefined)
		logService.print(message.stdout);
	else if (message.text !== "") reportServerMessage(logService, message, cwd);
}

/** What Rojo said while it ran. */
export function reportRojo(
	logService: LogService,
	messages: readonly ServerMessage[],
	cwd: string
): void {
	for (const message of messages) {
		reportServerOutput(logService, message, cwd);
	}
}

/** What Rojo said that its failure doesn't repeat: the failure carries its errors. */
export function reportRojoBesideFailure(
	logService: LogService,
	messages: readonly ServerMessage[],
	cwd: string
): void {
	reportRojo(
		logService,
		messages.filter(({ severity }) => severity !== "error"),
		cwd
	);
}

const S = OutputShape;

/** What a run of Rojo's `build`, `sourcemap` or `upload` reports: `built` when Rojo ran without an error. */
export const rojoEntryShape = (command: RojoTarget["command"]) =>
	S.named(
		"RojoEntry",
		S.object({
			command: S.enum(command),
			outcome: S.enum("built", "failed", "notRun"),
			project: S.nullable(S.string),
			output: S.optional(S.string),
			plugin: S.optional(S.string),
			messages: S.array(
				S.object({
					severity: S.enum("error", "warning", "info"),
					text: S.string,
				})
			),
			diagnostics: S.optional(S.array(diagnosticShape)),
			error: S.optional(errorShape),
		})
	);

export const buildRojoEntryShape = rojoEntryShape("build");

/** What `-o` or `-p` asked Rojo to write. */
export interface RojoTarget {
	readonly command: "build" | "sourcemap" | "upload";
	readonly cwd: string;
	readonly output?: string;
	readonly plugin?: string;
}

/** Rojo's build for `-o` or `-p`: `notRun` when the project files had errors, so Rojo had nothing to build. */
export interface RojoEntry {
	readonly command: RojoTarget["command"];
	readonly outcome: "built" | "failed" | "notRun";
	readonly project: string | null;
	/** The absolute path `-o` names. */
	readonly output?: string;
	/** The file name `-p` names. */
	readonly plugin?: string;
	/** What Rojo said, bar its debug output. */
	readonly messages: readonly ServerMessage[];
	readonly diagnostics?: readonly DiagnosticJson[];
	/** Why it failed, when that isn't a diagnostic. */
	readonly error?: ErrorJson;
}

export function rojoEntry(
	target: RojoTarget,
	ran: Result<RojoCommandRun, Error> | undefined
): RojoEntry {
	const named = {
		command: target.command,
		...(target.output !== undefined && {
			output: toNative(path.resolve(target.cwd, target.output)),
		}),
		...(target.plugin !== undefined && { plugin: target.plugin }),
	};
	if (ran === undefined)
		return { ...named, outcome: "notRun", project: null, messages: [] };
	if (ran.isErr())
		return {
			...named,
			outcome: "failed",
			project: null,
			messages: [],
			...failureToJson(ran.error),
		};
	const { project, messages, failure } = ran.value;
	return {
		...named,
		outcome: failure ? "failed" : "built",
		project: toNative(project.projectFile),
		messages: messages
			.filter(({ severity }) => severity !== "debug")
			.map(({ severity, text }) => ({ severity, text })),
		...(failure && failureToJson(failure)),
	};
}
