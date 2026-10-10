import path from "path";
import { UsageError } from "../../base/errors.js";
import { samePath } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ResolvedConfig } from "../config/config.js";
import {
	ServeAddress,
	ServerDefaults,
	ServerInfo,
	SyncServer,
} from "./serve.js";
import { ServeTarget, ServeTool } from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-record.js";

/** How many ports past a taken one are tried for a free one to suggest. */
const FREE_PORT_SEARCH = 20;

/** Where each config is served, and whether its port is free for it, when a serve starts and whenever its configs change. */
export class ServePorts {
	constructor(
		private readonly fileSystemService: FileSystemService,
		private readonly probe: ServerProbe,
		private readonly records: ServerRecords,
		private readonly userHome: string
	) {}

	/** The address the server will listen on: the flags after `--`, then the project file, then the server's own settings and defaults. */
	async targetOf(
		config: ResolvedConfig,
		tool: ServeTool,
		serverArgs: readonly string[]
	): Promise<ServeTarget> {
		const { server } = tool;
		const project = config.template?.project;
		const defaults = await this.defaultsOf(server, config.projectDir);
		return {
			config,
			project: config.name,
			address: new ServeAddress(
				server.hostIn(serverArgs) ??
					project?.serveAddress ??
					defaults.host ??
					server.defaultHost,
				server.portIn(serverArgs) ??
					project?.servePort ??
					defaults.port ??
					server.defaultPort
			),
		};
	}

	/** Two targets on one port can't both be served; the command line is what has to change. */
	clashOf(
		targets: readonly ServeTarget[],
		portGiven: boolean
	): UsageError | undefined {
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
		const first = clashes[0][1][0].config.label;
		const fix = portGiven
			? `The --port after '--' applies to every config: serve one at a time, as 'rogen serve ${first} -- --port <port>'.`
			: `Give each its own servePort in its template, or serve one at a time, as 'rogen serve ${first}'.`;
		return new UsageError([...lines, fix].join("\n"));
	}

	/** `target` once its port is free, or with `running` set when its own project is already served there; otherwise why it can't be served. `others` are the targets served beside it, and `sharedName` says another of them has its project's name, so a server of that name can't be told apart. */
	async check(
		target: ServeTarget,
		others: readonly ServeTarget[],
		server: SyncServer,
		sharedName: boolean
	): Promise<Result<ServeTarget, Diagnostic>> {
		const state = await this.probe.probe(target.address, server);
		if (state.kind === "free") return ok(target);
		const holder = state.kind === "serving" ? state.info : undefined;
		const elsewhere =
			holder && (await this.records.read(target.address, holder));
		const ownServer =
			holder?.project === target.project &&
			!sharedName &&
			(!elsewhere ||
				samePath(elsewhere.projectFile, target.config.outFile));
		if (ownServer) return ok({ ...target, running: holder });
		return err(
			await this.portTaken(
				target,
				holder,
				elsewhere ? path.dirname(elsewhere.projectFile) : undefined,
				others,
				server
			)
		);
	}

	/** Why `target` can't be served beside `holder`'s server on its port, which is one of the targets this serve runs. */
	sharedPort(target: ServeTarget, holder: ServeTarget): Diagnostic {
		const { config, address } = target;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.template?.file ?? config.file },
			`Port ${address.port} is taken by the server of ${holder.config.label}, so ${config.label} can't be served there. Give ${config.label} ${this.ownPortIn(config)}, or serve it on its own, as 'rogen serve ${config.label}'.`
		);
	}

	private async defaultsOf(
		server: SyncServer,
		projectDir: string
	): Promise<ServerDefaults> {
		for (const file of server.settingsFiles(projectDir, this.userHome)) {
			let text: string;
			try {
				if (!(await this.fileSystemService.exists(file))) continue;
				text = await this.fileSystemService.readFile(file);
			} catch {
				continue;
			}
			return server.defaultsIn(text);
		}
		return {};
	}

	/** `from` is the folder of the project file the holder serves, when a serve recorded it. */
	private async portTaken(
		target: ServeTarget,
		holder: ServerInfo | undefined,
		from: string | undefined,
		targets: readonly ServeTarget[],
		server: SyncServer
	): Promise<Diagnostic> {
		const { config, address } = target;
		const by = holder
			? `${holder.server.name} serving ${holder.project}${from ? ` from ${from}` : ""}`
			: "another program";
		const free = address.isLocal
			? await this.freePortAfter(address, targets, server)
			: undefined;
		const command = `rogen serve ${config.label} -- --port ${free ?? "<port>"}`;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.template?.file ?? config.file },
			`Port ${address.port} is taken by ${by}, so ${config.label} can't be served there. Give ${config.label} ${this.ownPortIn(config)}, or run '${command}'.`,
			free === undefined
				? []
				: [
						{
							run: {
								command,
								cwd: path.dirname(config.file),
							},
						},
					]
		);
	}

	private ownPortIn(config: ResolvedConfig): string {
		return config.template
			? `its own servePort in ${path.basename(config.template.file)}`
			: "a template with its own servePort";
	}

	private async freePortAfter(
		address: ServeAddress,
		targets: readonly ServeTarget[],
		server: SyncServer
	): Promise<number | undefined> {
		const planned = new Set(targets.map((target) => target.address.port));
		for (let offset = 1; offset <= FREE_PORT_SEARCH; offset++) {
			const port = address.port + offset;
			if (port > 65535) return undefined;
			if (planned.has(port)) continue;
			const state = await this.probe.probe(
				new ServeAddress(address.host, port),
				server
			);
			if (state.kind === "free") return port;
		}
		return undefined;
	}
}
