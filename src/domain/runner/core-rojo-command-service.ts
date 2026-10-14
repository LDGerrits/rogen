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
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const chosen = ProjectChoice.read(configs.value, selection.named);
		if (chosen.length !== 1)
			return err(CoreRojoCommandService.notOne(chosen.length, request));
		const [project] = chosen;

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
		const exit = await ended;
		request.signal?.removeEventListener("abort", onAbort);
		rojo[Symbol.dispose]();

		if (exit.code === 0 || exit.interrupted || request.signal?.aborted)
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

	private static notOne(
		count: number,
		request: RojoCommandRequest
	): UsageError {
		return new UsageError(
			count === 0
				? `There is no project to run 'rojo ${request.command}' on.`
				: `'rojo ${request.command}' runs on one project, and this selects ${count}. Name one: a folder with a rogen.json, or a project.`
		);
	}
}
