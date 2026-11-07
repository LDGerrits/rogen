import path from "path";
import { UsageError } from "../../base/errors.js";
import { samePath, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { commandWith, shellWord } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ConfigService } from "../config/config-service.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoRunner } from "../runner/rojo-runner.js";
import { RojoServer, ServerInfo } from "../runner/rojo-server.js";
import { ServeFlags } from "../runner/serve-flags.js";
import { ServeAddress } from "./serve.js";
import { ServeTarget } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecord, ServerRecords } from "./server-records.js";

const FREE_PORT_SEARCH = 20;

type RecordStanding = "ours" | "orphan" | "stale" | "unowned";

/** Who holds a serve port: nothing, a program that isn't Rojo, a Rojo no `rogen serve` recorded for the project file, one that answers for the project before its record is written, or one recorded for the project file, standing by whether its serve and leading process still run. */
export type PortHolder =
	| { readonly kind: "free" }
	| { readonly kind: "taken" }
	| {
			readonly kind: "foreign";
			readonly info: ServerInfo;
			readonly record?: ServerRecord;
	  }
	| { readonly kind: "pending"; readonly info: ServerInfo }
	| {
			readonly kind: RecordStanding;
			readonly info: ServerInfo;
			readonly record: ServerRecord;
	  };

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
		private readonly runner: RojoRunner,
		private readonly configService: ConfigService
	) {
		this.host = ServeFlags.hostIn(serverArgs);
		this.port = ServeFlags.portIn(serverArgs);
		this.otherArgs = ServeFlags.withoutPort(serverArgs);
	}

	get portError(): UsageError | undefined {
		return this.port.isErr() ? this.port.error : undefined;
	}

	/** The server a `rogen serve` that still runs started for `config`, on whatever port, when no `--port` was given to pick one. */
	async runningServeOf(
		config: ResolvedConfig
	): Promise<ServeTarget | undefined> {
		if (this.port.unwrapOr(undefined) !== undefined) return undefined;
		for (const recorded of await this.records.recordsFor(
			config.projectFile
		)) {
			if (this.standingOf(recorded) !== "ours") continue;
			const target = {
				...this.targetOf(config),
				address: new ServeAddress(recorded.host, recorded.port),
			};
			const holder = await this.classify(target);
			if (holder.kind === "ours")
				return { ...target, servedBy: holder.info };
		}
		return undefined;
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

	/** What holds `target`'s port, told from the server that answers there and the record a `rogen serve` left for it. */
	async classify(target: ServeTarget): Promise<PortHolder> {
		const state = await this.probe.probe(target.address);
		if (state.kind !== "serving") return state;
		const { info } = state;
		const record = await this.records.recordOf(target.address, info);
		if (record && samePath(record.projectFile, target.config.projectFile))
			return { kind: this.standingOf(record), info, record };
		if (!record && info.project === target.project)
			return { kind: "pending", info };
		return { kind: "foreign", info, record };
	}

	/** `target` once its port is free, with `servedBy` set when another `rogen serve` serves it there, or with `orphan` set when a server no serve runs for holds it; else why it can't be served. */
	async check(target: ServeTarget): Promise<Result<ServeTarget, Diagnostic>> {
		const holder = await this.classify(target);
		switch (holder.kind) {
			case "free":
				return ok(target);
			case "taken":
				return err(await this.portTaken(target, undefined, undefined));
			case "foreign":
				return err(
					await this.portTaken(target, holder.info, holder.record)
				);
			case "pending":
				return err(
					await this.portTaken(target, holder.info, undefined)
				);
			case "ours":
				return ok({ ...target, servedBy: holder.info });
			case "orphan":
			case "stale":
			case "unowned":
				return ok({ ...target, orphan: holder.record });
		}
	}

	/** How a record for this project file stands: a record without an owner is as stale as one whose owner ended. */
	private standingOf(record: ServerRecord): RecordStanding {
		if (record.owner === undefined) return "unowned";
		if (this.runner.isRunning(record.owner)) return "ours";
		return record.pid !== undefined && this.runner.isRunning(record.pid)
			? "orphan"
			: "stale";
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
		const serve = `${commandWith("rogen serve", await this.configService.referenceTo(config.file, this.cwd))} --port`;
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
