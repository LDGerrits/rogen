import path from "path";
import { compareStrings } from "../../base/collections.js";
import { UsageError } from "../../base/errors.js";
import { samePath, toPosix } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { ResolvedConfig } from "../config/config.js";
import { ServerInfo, SyncServer } from "../runner/sync-server.js";
import { ServeAddress } from "./serve.js";
import { ServeTarget } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";

/** How many ports past a taken one are tried for a free one to suggest. */
const FREE_PORT_SEARCH = 20;

/** The other configs of `configs` with `config`'s project name, which a server that only says that name could be serving. */
export function namesakesOf(
	config: ResolvedConfig,
	configs: readonly ResolvedConfig[]
): ResolvedConfig[] {
	return configs.filter(
		(other) =>
			other.file !== config.file &&
			other.projectName === config.projectName
	);
}

/** Where each config of one serve is served, and whether its port is free for it, when the serve starts and whenever its configs change. */
export class ServePorts {
	private readonly host: string | undefined;
	private readonly port: Result<number | undefined, UsageError>;

	/** `serverArgs` are the words after `--`, which the server gets as they are. */
	constructor(
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly server: SyncServer,
		serverArgs: readonly string[],
		/** The folder commands in messages run from. */
		private readonly cwd: string
	) {
		this.host = server.hostIn(serverArgs);
		this.port = server.portIn(serverArgs);
	}

	/** The error in the `--port` after `--`, when its value isn't a port. */
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
					project?.servePort ??
					server.defaultPort
			),
		};
	}

	/** Two targets on one port can't both be served; the command line is what has to change. */
	clashOf(targets: readonly ServeTarget[]): UsageError | undefined {
		const portGiven = this.port.unwrapOr(undefined) !== undefined;
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
		const fix = portGiven
			? `The --port after '--' applies to every config: serve one at a time, as 'rogen serve ${first} -- --port <port>'.`
			: `Give each its own servePort in its rogen.json, or serve one at a time, as 'rogen serve ${first}'.`;
		return new UsageError([...lines, fix].join("\n"));
	}

	/** `target` once its port is free, or with `servedBy` set when its project is already served there (`adopted` when no serve recorded that server); else why it can't be served. */
	async check(
		target: ServeTarget,
		others: readonly ServeTarget[],
		namesakes: readonly ResolvedConfig[]
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
				return ok({ ...target, servedBy: holder });
			if (!recorded)
				return namesakes.length === 0
					? ok({ ...target, servedBy: holder, adopted: true })
					: err(this.unknownServer(target, holder, namesakes));
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

	/** Why `target` can't be served beside `holder`'s server on its port, which is one of the targets this serve runs. */
	sharedPort(target: ServeTarget, holder: ServeTarget): Diagnostic {
		const { config, address } = target;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.file },
			`Port ${address.port} is taken by the server of ${holder.config.label}, so ${config.label} can't be served there. Give ${config.label} ${this.ownPortIn(config)}, or serve it on its own, as 'rogen serve ${this.refOf(config)}'.`
		);
	}

	/** `from` is the folder of the project file the holder serves, when a serve recorded it. */
	private async portTaken(
		target: ServeTarget,
		holder: ServerInfo | undefined,
		from: string | undefined,
		targets: readonly ServeTarget[]
	): Promise<Diagnostic> {
		const { config, address } = target;
		const by = holder
			? `${holder.server.name} serving ${holder.project}${from ? ` from ${from}` : ""}`
			: "another program";
		const free = address.isLocal
			? await this.freePortAfter(address, targets)
			: undefined;
		const command = `rogen serve ${this.refOf(config)} -- --port ${free ?? "<port>"}`;
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

	/** Why `target` can't be told apart from its `namesakes` on `holder`, which no serve recorded. */
	private unknownServer(
		target: ServeTarget,
		holder: ServerInfo,
		namesakes: readonly ResolvedConfig[]
	): Diagnostic {
		const { config, address } = target;
		const labels = [config, ...namesakes]
			.map((named) => this.refOf(named))
			.sort(compareStrings);
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.file },
			`Port ${address.port} is taken by ${holder.server.name} serving ${holder.project}, the name of ${joinedWithAnd(labels)}, so Rogen can't tell whether it serves ${this.refOf(config)}. Stop it, and run 'rogen serve' again to start the server.`
		);
	}

	/** The folder of `config` as a command run from `cwd` names it. */
	private refOf(config: ResolvedConfig): string {
		return (
			toPosix(path.relative(this.cwd, path.dirname(config.file))) || "."
		);
	}

	private ownPortIn(config: ResolvedConfig): string {
		return `its own servePort in ${path.basename(config.file)}`;
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
