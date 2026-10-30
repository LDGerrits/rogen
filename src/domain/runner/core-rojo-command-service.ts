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
	RojoWatch,
	RojoWatchRequest,
} from "./rojo-command-service.js";
import { RojoCompatibility } from "./rojo-compatibility.js";
import { RojoVersion } from "./rojo-version.js";
import { RojoRunner, ServerExecutable } from "./rojo-runner.js";
import { RojoServer, ServerMessage } from "./rojo-server.js";
import { WatchingRojo } from "./watching-rojo.js";

/** How Rojo exited, and each line of the errors it wrote, in order. */
interface RojoFailure {
	readonly how: string;
	readonly said: readonly string[];
}

const WHAT_FAILED: Readonly<Record<string, string>> = {
	build: "build",
	upload: "upload",
	sourcemap: "make a sourcemap of",
	syncback: "sync back into",
};

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
		const prepared = await this.prepare(selection, request);
		if (prepared.isErr()) return prepared;
		const { project, executable, projectFile } = prepared.value;
		const ran = await this.spawn(
			executable,
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
				failure: this.commandFailure(
					request.command,
					project,
					ran.failure,
					ran.refusedArguments ? "usage" : "project"
				),
			}),
		});
	}

	async watch(
		selection: ConfigSelection,
		request: RojoWatchRequest
	): Promise<Result<RojoWatch, Error>> {
		const prepared = await this.prepare(selection, request);
		if (prepared.isErr()) return prepared;
		if (request.signal?.aborted)
			return err(new Error("The watch stopped before Rojo started."));
		const { project, executable, projectFile } = prepared.value;
		return ok(
			new WatchingRojo(
				project,
				() =>
					this.rojoRunner.start(
						executable,
						request.command,
						path.relative(request.cwd, projectFile),
						[...request.flags, "--watch"],
						request.cwd,
						true
					),
				(said) =>
					this.commandFailure(request.command, project, {
						how: "an error",
						said,
					}),
				request.beforeRestart
			)
		);
	}

	/** The project, the Rojo that runs on it and the file it reads, once the checks pass. */
	private async prepare(
		selection: ConfigSelection,
		request: RojoCommandRequest
	): Promise<
		Result<
			{
				project: ResolvedConfig;
				executable: ServerExecutable;
				projectFile: string;
			},
			Error
		>
	> {
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
		const problems = await this.compatibility.problemsIn(
			executable.value,
			[projectFile],
			request.command
		);
		if (problems.length > 0) return err(new DiagnosticsError(problems));
		return ok({ project, executable: executable.value, projectFile });
	}

	private commandFailure(
		command: string,
		project: ResolvedConfig,
		failure: RojoFailure,
		kind: "usage" | "project" = "project"
	): DiagnosticsError {
		return new DiagnosticsError(
			[
				{
					...errorDiagnostic(
						"rojo.commandFailed",
						{ resource: project.projectFile },
						this.failed(
							`${WHAT_FAILED[command] ?? `run '${command}' on`} this project`,
							failure
						)
					),
					...(failure.said.length > 0 && {
						details: failure.said,
					}),
				},
			],
			kind
		);
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
			request.signal
		);
		if (!ran.failure) return ok({ messages: ran.messages });
		const failure = [
			this.failed(
				`run '${RojoServer.COMMAND} ${request.args.join(" ")}'`,
				ran.failure
			),
			...ran.failure.said.map((line) => `  ${line}`),
		].join("\n");
		return ok({
			messages: ran.messages,
			failure: ran.refusedArguments
				? new UsageError(failure)
				: new ToolError(failure),
		});
	}

	/** Rogen's sentence about what failed: it ends in a colon when Rojo's own lines follow it. */
	private failed(what: string, { how, said }: RojoFailure): string {
		return said.length > 0
			? `Rojo couldn't ${what}:`
			: `Rojo couldn't ${what} (${how}).`;
	}

	/** Runs `command`, and says why it failed when Rojo exited with an error. */
	private async spawn(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string,
		signal: AbortSignal | undefined
	): Promise<{
		messages: ServerMessage[];
		failure?: RojoFailure;
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
			.flatMap(({ text, details }) => [text, ...(details ?? [])]);
		const how = exit.error
			? exit.error.message
			: `exit code ${exit.code === null ? exit.signal : exitCodeText(exit.code)}`;
		return {
			messages,
			failure: { how, said },
			refusedArguments: exit.code === 2,
		};
	}

	choose(selection: ConfigSelection): ResolvedConfig {
		return selection.configs[0];
	}
}
