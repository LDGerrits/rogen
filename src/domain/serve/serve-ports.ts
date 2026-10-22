import path from "path";
import { UsageError } from "../../base/errors.js";
import { samePath, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { shellWord } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DEFAULT_PROJECT } from "../config/config.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoRunner } from "../runner/rojo-runner.js";
import { RojoServer, ServerInfo } from "../runner/rojo-server.js";
import { ServeFlags } from "../runner/serve-flags.js";
import { ServeAddress } from "./serve.js";
import { ServeTarget } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecord, ServerRecords } from "./server-records.js";

const FREE_PORT_SEARCH = 20;

export class ServePorts {
	private readonly host: string | undefined;
	private readonly port: Result<number | undefined, UsageError>;
	/** The flags other than the port that a command offered for another port repeats. */
	private readonly otherArgs: readonly string[];

	constructor(
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		serverArgs: readonly string[],
		private readonly cwd: string,
		private readonly runner: RojoRunner
	) {
		this.host = ServeFlags.hostIn(serverArgs);
		this.port = ServeFlags.portIn(serverArgs);
		this.otherArgs = ServeFlags.withoutPort(serverArgs);
	}

	get portError(): UsageError | undefined {
		return this.port.isErr() ? this.port.error : undefined;
	}

	/** The address the server will listen on: the flags given to serve, then the project file, then the server's own defaults. */
	targetOf(config: ResolvedConfig): ServeTarget {
		const { project } = config;
		return {
			config,
			project: config.projectName,
			address: new ServeAddress(
				this.host ?? project?.serveAddress ?? RojoServer.DEFAULT_HOST,
				this.port.unwrapOr(undefined) ??
					project?.servePort ??
					RojoServer.DEFAULT_PORT
			),
		};
	}

	/** Whether the server on `target`'s port was recorded for its project file by a `rogen serve` that has ended. */
	async ownerEndedFor(
		target: ServeTarget,
		holder: ServerInfo
	): Promise<boolean> {
		const recorded = await this.records.recordOf(target.address, holder);
		return (
			recorded !== undefined &&
			samePath(recorded.projectFile, target.config.projectFile) &&
			this.ownerEnded(recorded)
		);
	}

	/** `target` once its port is free, or with `servedBy` set when its project is already served there; else why it can't be served. */
	async check(target: ServeTarget): Promise<Result<ServeTarget, Diagnostic>> {
		const state = await this.probe.probe(target.address);
		if (state.kind === "free") return ok(target);
		const holder = state.kind === "serving" ? state.info : undefined;
		const recorded =
			holder && (await this.records.recordOf(target.address, holder));
		if (
			holder?.project === target.project &&
			recorded &&
			samePath(recorded.projectFile, target.config.projectFile)
		) {
			const served = this.targetServedBy(target, holder, recorded);
			if (served) return ok(served);
			return err(await this.portTaken(target, holder, undefined));
		}
		return err(await this.portTaken(target, holder, recorded));
	}

	/** Whether the `rogen serve` that started the recorded server has ended; a record without an owner can't tell. */
	ownerEnded(record: ServerRecord): boolean {
		return (
			record.owner !== undefined && !this.runner.isRunning(record.owner)
		);
	}

	/** The target as its recorded server serves it: left alone while its `rogen serve` runs, to end when only a server is left; none when there is no process to end. */
	private targetServedBy(
		target: ServeTarget,
		holder: ServerInfo,
		recorded: ServerRecord
	): ServeTarget | undefined {
		if (!this.ownerEnded(recorded)) return { ...target, servedBy: holder };
		return recorded.pid !== undefined && this.runner.isRunning(recorded.pid)
			? { ...target, orphan: recorded }
			: undefined;
	}

	private async portTaken(
		target: ServeTarget,
		holder: ServerInfo | undefined,
		recorded: ServerRecord | undefined
	): Promise<Diagnostic> {
		const { config, address } = target;
		const by =
			holder && recorded
				? `taken by Rojo serving ${holder.project}, which rogen serve started for ${this.nameOfFile(recorded.configFile ?? recorded.projectFile)}`
				: `held by another process${holder ? ` (Rojo serving ${holder.project})` : ""}`;
		const free = address.isLocal
			? await this.freePortAfter(address)
			: undefined;
		const rest =
			this.otherArgs.length === 0
				? ""
				: ` ${this.otherArgs.map(shellWord).join(" ")}`;
		const serve = `rogen serve ${this.refOf(config)} --port`;
		const command = `${serve} ${free ?? "<port>"}${rest}`;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.file },
			`Port ${address.port} is ${by}, so ${this.nameOf(config)} can't be served there. Stop it, set a servePort in ${this.nameOf(config)}, or run '${serve} <port>${rest}'.`,
			free === undefined
				? []
				: [
						{
							run: { command, cwd: this.cwd },
						},
					]
		);
	}

	/** What a command names `config` by: its folder for a default, else its file. */
	private refOf(config: ResolvedConfig): string {
		return path.basename(config.file).startsWith(`${DEFAULT_PROJECT}.`)
			? toPosix(path.relative(this.cwd, path.dirname(config.file))) || "."
			: this.nameOfFile(config.file);
	}

	private serveCommand(config: ResolvedConfig): string {
		const ref = this.refOf(config);
		return ref === "." ? "rogen serve" : `rogen serve ${ref}`;
	}

	private nameOf(config: ResolvedConfig): string {
		return this.nameOfFile(config.file);
	}

	private nameOfFile(file: string): string {
		const relative = toPosix(path.relative(this.cwd, file));
		return relative === "" || relative.startsWith("..") ? file : relative;
	}

	private async freePortAfter(
		address: ServeAddress
	): Promise<number | undefined> {
		for (let offset = 1; offset <= FREE_PORT_SEARCH; offset++) {
			const port = address.port + offset;
			if (port > 65535) return undefined;
			const state = await this.probe.probe(
				new ServeAddress(address.host, port)
			);
			if (state.kind === "free") return port;
		}
		return undefined;
	}
}
