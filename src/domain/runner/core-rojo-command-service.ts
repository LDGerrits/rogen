import path from "path";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	ProcessExit,
	exitCodeText,
} from "../../platform/process/process-service.js";
import { ConfigSelection } from "../config/config-service.js";
import { ProjectChoice } from "../config/project-choice.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import {
	RojoCommandRequest,
	RojoCommandRun,
	RojoCommandService,
} from "./rojo-command-service.js";
import { RojoCompatibility } from "./rojo-compatibility.js";
import { RojoRunner } from "./rojo-runner.js";
import { ServerMessage } from "./sync-server.js";

export class CoreRojoCommandService implements RojoCommandService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly rojoRunner: RojoRunner,
		private readonly compatibility: RojoCompatibility
	) {}

	async run(
		selection: ConfigSelection,
		request: RojoCommandRequest
	): Promise<Result<RojoCommandRun, Error>> {
		const valid = selection.requireValid();
		if (valid.isErr()) return valid;
		const chosen = this.choose(selection, request.command);
		if (chosen.isErr()) return chosen;
		const project = chosen.value;

		const executable = await this.rojoRunner.find(
			selection.home,
			project.file,
			request.signal
		);
		if (executable.isErr()) return executable;
		const problems = await this.compatibility.problemsIn(executable.value, [
			project.projectFile,
		]);
		if (problems.length > 0) return err(new DiagnosticsError(problems));

		if (request.signal?.aborted) return ok({ project, messages: [] });
		const rojo = this.rojoRunner.start(
			executable.value,
			request.command,
			path.relative(request.cwd, project.projectFile),
			request.flags,
			request.cwd
		);
		const messages: ServerMessage[] = [];
		rojo.onDidMessage((message) => messages.push(message));
		const ended = new Promise<ProcessExit>((resolve) =>
			rojo.onDidExit(resolve)
		);
		const onAbort = () => void rojo.terminate();
		request.signal?.addEventListener("abort", onAbort, { once: true });
		if (request.signal?.aborted) onAbort();
		const exit = await ended;
		request.signal?.removeEventListener("abort", onAbort);
		rojo[Symbol.dispose]();

		if (exit.code === 0 || request.signal?.aborted)
			return ok({ project, messages });
		const said = messages
			.filter(({ severity }) => severity === "error")
			.map(({ text }) => text);
		const how = exit.error
			? exit.error.message
			: `exit code ${exit.code === null ? exit.signal : exitCodeText(exit.code)}`;
		return err(
			new DiagnosticsError([
				errorDiagnostic(
					"rojo.commandFailed",
					{ resource: project.projectFile },
					`'${executable.value.server.id} ${request.command}' failed (${how})${said.length > 0 ? `: ${said.join(" ")}` : "."}`
				),
			])
		);
	}

	choose(
		selection: ConfigSelection,
		command: string
	): Result<ResolvedConfig, UsageError> {
		const chosen = ProjectChoice.read(selection.configs, selection.named);
		if (chosen.length === 1) return ok(chosen[0]);
		return err(
			new UsageError(
				chosen.length === 0
					? `There is no project to run 'rojo ${command}' on.`
					: `'rojo ${command}' runs on one project, and this selects ${chosen.length}. Name one: a folder with a rogen.json, or a project.`
			)
		);
	}
}
