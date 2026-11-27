import path from "path";
import { ToolError, UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { errorDiagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ProcessExit } from "../../platform/process/process-service.js";
import {
	ConfigSelection,
	ConfigService,
	ReloadableSelection,
	singleProjectError,
} from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { WatchService } from "../watch/watch-service.js";
import { WriteService } from "../write/write-service.js";
import {
	RojoBareRequest,
	RojoBareRun,
	RojoCommandRequest,
	RojoCommandRun,
	RojoCommandService,
	RojoRunOutcome,
	RojoRunRequest,
	RojoRunWatch,
} from "./rojo-command-service.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { RojoCompatibility } from "./rojo-compatibility.js";
import { RojoVersion } from "./rojo-version.js";
import { RojoRunner, ServerExecutable, exitHow } from "./rojo-runner.js";
import { RojoServer, ServerMessage } from "./rojo-server.js";
import { WatchedRojoRun } from "./watched-rojo-run.js";
import { WatchingRojo } from "./watching-rojo.js";

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

const HELP_POINTER = /^For more information,? try '?--help'?\.?$/;

export class CoreRojoCommandService implements RojoCommandService {
	declare readonly _serviceBrand: undefined;

	private readonly compatibility: RojoCompatibility;

	constructor(
		@RojoRunner private readonly rojoRunner: RojoRunner,
		@ConfigService private readonly configService: ConfigService,
		@WriteService private readonly writeService: WriteService,
		@WatchService private readonly watchService: WatchService,
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {
		this.compatibility =
			instantiationService.createInstance(RojoCompatibility);
	}

	async run(request: RojoRunRequest): Promise<Result<RojoRunOutcome, Error>> {
		const entered = await this.enter(request);
		if (entered.isErr()) return entered;
		const { selection, flags } = entered.value;
		const valid = selection.requireValid();
		const project = valid.isOk() ? valid.value[0] : undefined;
		const written = await this.writeService.write(selection);
		const failure = written.failure();
		const ran =
			failure || project === undefined
				? undefined
				: await this.runOn(selection, {
						command: request.command,
						flags,
						cwd: request.cwd,
						project,
						prints: request.prints,
						signal: request.signal,
					});
		const rojoFailure =
			ran === undefined
				? undefined
				: ran.isErr()
					? ran.error
					: ran.value.failure;
		const built = ran?.isOk() === true && rojoFailure === undefined;
		return ok({
			home: selection.home,
			notes: selection.notes,
			project,
			written,
			ran,
			failure: failure
				? { at: "write", error: failure }
				: rojoFailure && { at: "rojo", error: rojoFailure },
			changed: written.changed || (request.command !== "upload" && built),
		});
	}

	async watch(request: RojoRunRequest): Promise<Result<RojoRunWatch, Error>> {
		const entered = await this.enter(request);
		if (entered.isErr()) return entered;
		const { selection, flags } = entered.value;
		const watched = this.watchService.watch(selection);
		if (watched.isErr()) return watched;
		const { command, cwd, prints } = request;
		return ok(
			this.instantiationService.createInstance(
				WatchedRojoRun,
				selection,
				watched.value,
				{
					find: (project: ResolvedConfig, signal?: AbortSignal) =>
						this.rojoRunner.find(
							selection.home,
							project.file,
							signal
						),
					problemsIn: (
						executable: ServerExecutable,
						projectFiles: readonly string[]
					) =>
						this.compatibility.problemsIn(
							executable,
							projectFiles,
							command
						),
					watch: (
						executable: ServerExecutable,
						project: ResolvedConfig,
						beforeRestart: () => Promise<void>
					) =>
						this.watching(
							executable,
							{ command, flags, cwd, project, prints },
							beforeRestart
						),
				}
			)
		);
	}

	private async enter(request: RojoRunRequest): Promise<
		Result<
			{
				selection: ReloadableSelection;
				flags: readonly string[];
			},
			Error
		>
	> {
		const tooMany = singleProjectError(request.command, request.refs);
		if (tooMany) return err(tooMany);
		if (request.flags.isErr()) return request.flags;
		const selection = await this.configService.selectForRojo(request.refs);
		if (selection.isErr()) return selection;
		return ok({ selection: selection.value, flags: request.flags.value });
	}

	async runOn(
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
			request.signal,
			request.prints
		);
		const { messages, printed } = request.prints
			? RojoServer.printedBy(ran.messages)
			: { messages: ran.messages, printed: undefined };
		return ok({
			project,
			messages,
			...(printed !== undefined && { printed }),
			...(ran.failure && {
				failure: ran.refusedArguments
					? CoreRojoCommandService.refused(ran.failure)
					: this.commandFailure(
							request.command,
							project,
							ran.failure
						),
			}),
		});
	}

	private watching(
		executable: ServerExecutable,
		request: RojoCommandRequest,
		beforeRestart: () => Promise<void>
	): WatchingRojo {
		const { command, project, cwd } = request;
		return new WatchingRojo(
			project,
			this.rojoRunner.supervise(
				() =>
					this.rojoRunner.start(
						executable,
						command,
						path.relative(cwd, project.projectFile),
						[...request.flags, "--watch"],
						cwd,
						true
					),
				{ beforeRestart }
			),
			(said) =>
				this.commandFailure(command, project, {
					how: "an error",
					said,
				}),
			request.prints
		);
	}

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
		const { project } = request;

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
						{ resource: project.file },
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
		failure: RojoFailure
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
			"project"
		);
	}

	private static refused({ how, said }: RojoFailure): UsageError {
		return new UsageError(
			said.length > 0
				? [
						"Rojo refused the command line:",
						...said.map((line) => `  ${line}`),
					].join("\n")
				: `Rojo refused the command line (${how}).`
		);
	}

	private missingCommand(
		executable: ServerExecutable,
		request: RojoCommandRequest
	): string | undefined {
		if (request.since === undefined) return undefined;
		const version = RojoVersion.parse(executable.version);
		const since = RojoVersion.parse(request.since);
		if (!version || !since || !version.isBefore(since)) return undefined;
		return `Rojo ${version} has no '${request.command}' command. Update Rojo to ${since} or later.`;
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
		if (ran.refusedArguments)
			return ok({
				messages: ran.messages,
				failure: CoreRojoCommandService.refused(ran.failure),
			});
		const failure = [
			this.failed(
				`run '${RojoServer.COMMAND} ${request.args.join(" ")}'`,
				ran.failure
			),
			...ran.failure.said.map((line) => `  ${line}`),
		].join("\n");
		return ok({ messages: ran.messages, failure: new ToolError(failure) });
	}

	private failed(what: string, { how, said }: RojoFailure): string {
		return said.length > 0
			? `Rojo couldn't ${what}:`
			: `Rojo couldn't ${what} (${how}).`;
	}

	private async spawn(
		executable: ServerExecutable,
		command: string,
		projectFile: string | undefined,
		flags: readonly string[],
		cwd: string,
		signal: AbortSignal | undefined,
		keepStdoutWhenQuiet = false
	): Promise<{
		messages: ServerMessage[];
		failure?: RojoFailure;
		refusedArguments?: boolean;
	}> {
		if (signal?.aborted) return { messages: [] };
		const rojo = this.rojoRunner.start(
			executable,
			command,
			projectFile,
			flags,
			cwd,
			keepStdoutWhenQuiet
		);
		const messages: ServerMessage[] = [];
		rojo.onDidMessage((message) => messages.push(message));
		const ended = new Promise<ProcessExit>((resolve) =>
			rojo.onDidExit(resolve)
		);
		const onAbort = () => void rojo.terminate();
		signal?.addEventListener("abort", onAbort, { once: true });
		const exit = await ended;
		signal?.removeEventListener("abort", onAbort);
		rojo[Symbol.dispose]();

		if (exit.code === 0 || signal?.aborted) return { messages };
		const refusedArguments = exit.code === 2;
		const explainsFailure = ({ severity }: ServerMessage) =>
			refusedArguments ? severity !== "noise" : severity === "error";
		const said = messages
			.filter(explainsFailure)
			.flatMap(({ text, details }) => [text, ...(details ?? [])])
			.filter((line) => !(refusedArguments && HELP_POINTER.test(line)));
		return {
			messages: refusedArguments
				? messages.filter((message) => !explainsFailure(message))
				: messages,
			failure: { how: exitHow(exit), said },
			refusedArguments,
		};
	}
}
