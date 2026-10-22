import path from "path";
import { ToolError, UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import {
	ProcessExit,
	exitCodeText,
} from "../../platform/process/process-service.js";
import { ConfigSelection } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import {
	RojoBareRequest,
	RojoBareRun,
	RojoCommandRequest,
	RojoCommandRun,
	RojoCommandService,
} from "./rojo-command-service.js";
import { RojoCompatibility } from "./rojo-compatibility.js";
import { RojoVersion } from "./rojo-version.js";
import { RojoRunner, ServerExecutable } from "./rojo-runner.js";
import { RojoServer, ServerMessage } from "./rojo-server.js";

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
		const project = request.project ?? this.choose(selection);

		const executable = await this.rojoRunner.find(
			selection.home,
			project.file,
			request.signal
		);
		if (executable.isErr()) return executable;
		const projectFile = request.projectFile ?? project.projectFile;
		const missing = this.missingCommand(executable.value, request);
		if (missing)
			return err(
				new DiagnosticsError([
					errorDiagnostic(
						"rojo.commandUnsupported",
						{ resource: projectFile },
						missing
					),
				])
			);
		const problems = await this.compatibility.problemsIn(executable.value, [
			projectFile,
		]);
		if (problems.length > 0) return err(new DiagnosticsError(problems));

		const ran = await this.spawn(
			executable.value,
			request.command,
			path.relative(request.cwd, projectFile),
			request.flags,
			request.cwd,
			request.signal
		);
		return ok({
			project,
			messages: ran.messages,
			...(ran.failure && {
				failure: new DiagnosticsError(
					[
						errorDiagnostic(
							"rojo.commandFailed",
							{ resource: project.projectFile },
							ran.failure
						),
					],
					ran.refusedArguments ? "usage" : "project"
				),
			}),
		});
	}

	/** Why the Rojo that will run has no `request.command`, when it is older than the release that added it. */
	private missingCommand(
		executable: ServerExecutable,
		request: RojoCommandRequest
	): string | undefined {
		if (request.since === undefined) return undefined;
		const version = RojoVersion.parse(executable.version);
		const since = RojoVersion.parse(request.since);
		if (!version || !since || !version.isBefore(since)) return undefined;
		return `Rojo ${version} has no '${request.command}' command; Rojo ${since} added it. Change your Rojo pin to ${since} or later, or update the Rojo on the PATH.`;
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
			...(ran.failure && {
				failure: ran.refusedArguments
					? new UsageError(ran.failure)
					: new ToolError(ran.failure),
			}),
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
	): Promise<{
		messages: ServerMessage[];
		failure?: string;
		/** Whether Rojo exited 2, as it does for a command line it can't read. */
		refusedArguments?: boolean;
	}> {
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
			failure: `'${RojoServer.COMMAND} ${described}' failed (${how})${said.length > 0 ? `: ${said.join(" ")}` : "."}`,
			refusedArguments: exit.code === 2,
		};
	}

	choose(selection: ConfigSelection): ResolvedConfig {
		return selection.configs[0];
	}
}
