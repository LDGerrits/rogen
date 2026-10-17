import path from "path";
import { UsageError } from "../../base/errors.js";
import { samePath, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { joinedWithAnd, shellWord } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/resolved-config.js";
import { RojoRunner } from "../runner/rojo-runner.js";
import { ServerInfo, SyncServer } from "../runner/sync-server.js";
import { ServeAddress } from "./serve.js";
import { ServeTarget } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecord, ServerRecords } from "./server-records.js";

const FREE_PORT_SEARCH = 20;

export class ServePorts {
	private readonly host: string | undefined;
	private readonly port: Result<number | undefined, UsageError>;
	/** The server flags a command offered for another port passes on. */
	private readonly otherArgs: readonly string[];

	constructor(
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly server: SyncServer,
		serverArgs: readonly string[],
		private readonly cwd: string,
		private readonly adopt: boolean,
		private readonly runner: RojoRunner
	) {
		this.host = server.hostIn(serverArgs);
		this.port = server.portIn(serverArgs);
		this.otherArgs = server.withoutPort(serverArgs);
	}

	get portError(): UsageError | undefined {
		return this.port.isErr() ? this.port.error : undefined;
	}

	/** The address the server will listen on: the flags after `--`, then the project file, then the server's own defaults. */
	targetOf(config: ResolvedConfig): ServeTarget {
		const { server } = this;
		const { project } = config;
		return {
			config,
			project: config.projectName,
			address: new ServeAddress(
				this.host ?? project?.serveAddress ?? server.defaultHost,
				this.port.unwrapOr(undefined) ??
					config.placeServePort ??
					project?.servePort ??
					server.defaultPort
			),
		};
	}

	/** The error for a port given to several servers, which can't all listen on it. */
	portForSeveral(targets: readonly ServeTarget[]): UsageError | undefined {
		if (this.port.unwrapOr(undefined) === undefined || targets.length < 2)
			return undefined;
		return new UsageError(
			`--port names one server's port, and this serves ${joinedWithAnd(targets.map(({ config }) => config.label))}.`,
			"Serve one at a time, as 'rogen serve <project> --port <port>', or give each its own servePort in its rogen.json."
		);
	}

	clashOf(targets: readonly ServeTarget[]): UsageError | undefined {
		const byPort = new Map<number, ServeTarget[]>();
		for (const target of targets) {
			const sharing = byPort.get(target.address.port) ?? [];
			byPort.set(target.address.port, [...sharing, target]);
		}
		const clashes = [...byPort].filter(([, sharing]) => sharing.length > 1);
		if (clashes.length === 0) return undefined;
		const lines = clashes.map(
			([port, sharing]) =>
				`${joinedWithAnd(sharing.map(({ config }) => config.label))} ${sharing.length === 2 ? "both" : "all"} serve on port ${port}.`
		);
		const first = this.refOf(clashes[0][1][0].config);
		return new UsageError(
			lines.join("\n"),
			`Give each its own servePort in its rogen.json, or serve one at a time, as 'rogen serve ${first}'.`
		);
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
	async check(
		target: ServeTarget,
		others: readonly ServeTarget[]
	): Promise<Result<ServeTarget, Diagnostic>> {
		const state = await this.probe.probe(target.address, this.server);
		if (state.kind === "free") return ok(target);
		const holder = state.kind === "serving" ? state.info : undefined;
		const recorded =
			holder && (await this.records.recordOf(target.address, holder));
		if (holder?.project === target.project) {
			if (
				recorded &&
				samePath(recorded.projectFile, target.config.projectFile)
			)
				return ok(this.targetServedBy(target, holder, recorded));
			if (!recorded)
				return this.adopt
					? ok({ ...target, servedBy: holder, adopted: true })
					: err(this.unknownServer(target, holder));
		}
		return err(
			await this.portTaken(
				target,
				holder,
				recorded ? path.dirname(recorded.projectFile) : undefined,
				others
			)
		);
	}

	/** Whether the `rogen serve` that started the recorded server has ended; a record without an owner can't tell. */
	ownerEnded(record: ServerRecord): boolean {
		return (
			record.owner !== undefined && !this.runner.isRunning(record.owner)
		);
	}

	/** The target as its recorded server serves it: left alone while its `rogen serve` runs, to end when only a server is left, to watch when there is no process to end. */
	private targetServedBy(
		target: ServeTarget,
		holder: ServerInfo,
		recorded: ServerRecord
	): ServeTarget {
		if (!this.ownerEnded(recorded)) return { ...target, servedBy: holder };
		return recorded.pid !== undefined && this.runner.isRunning(recorded.pid)
			? { ...target, orphan: recorded }
			: { ...target, servedBy: holder, adopted: true };
	}

	sharedPort(target: ServeTarget, holder: ServeTarget): Diagnostic {
		const { config, address } = target;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.file },
			`Port ${address.port} is taken by the server of ${holder.config.label}, so ${config.label} can't be served there. Give ${config.label} ${this.ownPortIn(config)}, or serve it on its own, as 'rogen serve ${this.refOf(config)}'.`
		);
	}

	private async portTaken(
		target: ServeTarget,
		holder: ServerInfo | undefined,
		holderFolder: string | undefined,
		targets: readonly ServeTarget[]
	): Promise<Diagnostic> {
		const { config, address } = target;
		const by = holder
			? `${holder.server.name} serving ${holder.project}${holderFolder ? ` from ${holderFolder}` : ""}`
			: "another program";
		const free = address.isLocal
			? await this.freePortAfter(address, targets)
			: undefined;
		const rest =
			this.otherArgs.length === 0
				? ""
				: ` -- ${this.otherArgs.map(shellWord).join(" ")}`;
		const command = `rogen serve ${this.refOf(config)} --port ${free ?? "<port>"}${rest}`;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.file },
			`Port ${address.port} is taken by ${by}, so ${config.label} can't be served there. Give ${config.label} ${this.ownPortIn(config)}, or run '${command}'.`,
			free === undefined
				? []
				: [
						{
							run: { command, cwd: this.cwd },
						},
					]
		);
	}

	private unknownServer(target: ServeTarget, holder: ServerInfo): Diagnostic {
		const { config, address } = target;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.file },
			`Port ${address.port} is taken by ${holder.server.name} serving ${holder.project}, which no rogen serve started, so Rogen can't tell whether it serves ${config.label}'s project file. Stop it and run 'rogen serve' to start the server, or if it serves ${config.projectFile}, run 'rogen serve ${this.refOf(config)} --adopt'.`
		);
	}

	private refOf(config: ResolvedConfig): string {
		const folder =
			toPosix(path.relative(this.cwd, path.dirname(config.file))) || ".";
		return config.stem === config.serveProject
			? folder
			: toPosix(path.relative(this.cwd, config.projectFile));
	}

	private ownPortIn(config: ResolvedConfig): string {
		const file = config.isPlace
			? toPosix(path.relative(this.cwd, config.file))
			: path.basename(config.file);
		return `its own servePort in ${file}`;
	}

	private async freePortAfter(
		address: ServeAddress,
		targets: readonly ServeTarget[]
	): Promise<number | undefined> {
		const planned = new Set(targets.map((target) => target.address.port));
		for (let offset = 1; offset <= FREE_PORT_SEARCH; offset++) {
			const port = address.port + offset;
			if (port > 65535) return undefined;
			if (planned.has(port)) continue;
			const state = await this.probe.probe(
				new ServeAddress(address.host, port),
				this.server
			);
			if (state.kind === "free") return port;
		}
		return undefined;
	}
}
