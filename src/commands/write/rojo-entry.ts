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

const S = OutputShape;

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
					details: S.optional(S.array(S.string)),
				})
			),
			diagnostics: S.optional(S.array(diagnosticShape)),
			error: S.optional(errorShape),
		})
	);

export const buildRojoEntryShape = rojoEntryShape("build");

export interface RojoTarget {
	readonly command: "build" | "sourcemap" | "upload";
	readonly cwd: string;
	readonly output?: string;
	readonly plugin?: string;
	readonly asset?: string;
}

export interface RojoEntry {
	readonly command: RojoTarget["command"];
	readonly outcome: "built" | "failed" | "notRun";
	readonly project: string | null;
	readonly output?: string;
	readonly plugin?: string;
	readonly messages: readonly ServerMessage[];
	readonly diagnostics?: readonly DiagnosticJson[];
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
			.map(({ severity, text, details }) => ({
				severity,
				text,
				...(details && { details }),
			})),
		...(failure && failureToJson(failure)),
	};
}
