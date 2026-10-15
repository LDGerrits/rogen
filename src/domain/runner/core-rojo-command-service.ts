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
	RojoBareRequest,
	RojoBareRun,
	RojoCommandRequest,
	RojoCommandRun,
	RojoCommandService,
} from "./rojo-command-service.js";
import { RojoCompatibility } from "./rojo-compatibility.js";
import { RojoRunner, ServerExecutable } from "./rojo-runner.js";
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
		const chosen = request.project
			? ok(request.project)
			: this.choose(selection, request.command);
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

		const ran = await this.spawn(
			executable.value,
			request.command,
			path.relative(request.cwd, project.projectFile),
			request.flags,
			request.cwd,
			request.signal
		);
		return ok({
			project,
			messages: ran.messages,
			...(ran.failure && {
				failure: new DiagnosticsError([
					errorDiagnostic(
						"rojo.commandFailed",
						{ resource: project.projectFile },
						ran.failure
					),
				]),
			}),
		});
	}

	async runBare(
		request: RojoBareRequest
	): Promise<Result<RojoBareRun, Error>> {
		const executable = await this.rojoRunner.find(
			request.cwd,
			request.cwd,
			request.signal
		);
		if (executable.isErr()) return executable;
		const [command, ...flags] = request.args;
		const ran = await this.spawn(
			executable.value,
			command,
			undefined,
			flags,
			request.cwd,
			request.signal,
			request.args.join(" ")
		);
		return ok({
			messages: ran.messages,
			...(ran.failure && { failure: new Error(ran.failure) }),
		});
	}

	/** Runs `command`, and says why it failed when Rojo exited with an error. */
	private async spawn(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string,
		signal: AbortSignal | undefined,
		described = command
	): Promise<{ messages: ServerMessage[]; failure?: string }> {
		if (signal?.aborted) return { messages: [] };
		const rojo = this.rojoRunner.start(
			executable,
			command,
			projectFile,
			flags,
			cwd
		);
		const messages: ServerMessage[] = [];
		rojo.onDidMessage((message) => messages.push(message));
		const ended = new Promise<ProcessExit>((resolve) =>
			rojo.onDidExit(resolve)
		);
		const onAbort = () => void rojo.terminate();
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
		const exit = await ended;
		signal?.removeEventListener("abort", onAbort);
		rojo[Symbol.dispose]();

		if (exit.code === 0 || signal?.aborted) return { messages };
		const said = messages
			.filter(({ severity }) => severity === "error")
			.map(({ text }) => text);
		const how = exit.error
			? exit.error.message
			: `exit code ${exit.code === null ? exit.signal : exitCodeText(exit.code)}`;
		return {
			messages,
			failure: `'${executable.server.id} ${described}' failed (${how})${said.length > 0 ? `: ${said.join(" ")}` : "."}`,
		};
	}

	projects(selection: ConfigSelection): ResolvedConfig[] {
		return ProjectChoice.read(selection.configs, selection.named).filter(
			({ hasPlaces, rootFile }) =>
				!hasPlaces || selection.named.has(rootFile)
		);
	}

	choose(
		selection: ConfigSelection,
		command: string
	): Result<ResolvedConfig, UsageError> {
		const chosen = this.projects(selection);
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
