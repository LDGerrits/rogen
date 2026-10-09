import path from "path";
import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { joinedWithAnd } from "../../base/strings.js";
import {
	Diagnostic,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { RequestService } from "../../platform/request/request-service.js";
import { ConfigOptionValues, ResolvedConfig } from "../config/config.js";
import { ConfigSelection, ConfigService } from "../config/config-service.js";
import { WatchService } from "../watch/watch-service.js";
import { CoreServeSession } from "./core-serve-session.js";
import { ServeAddress, ServerInfo, SyncServer, leafConfigs } from "./serve.js";
import {
	ServePlan,
	ServeRequest,
	ServeService,
	ServeSession,
	ServeTarget,
	ServeTool,
} from "./serve-service.js";
import { ServerFinder } from "./server-finder.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-record.js";

/** How many ports past a taken one are tried for a free one to suggest. */
const FREE_PORT_SEARCH = 20;

/** A top-level `key = value` of a flat TOML file, as Argon's settings are written. */
function topLevelValue(text: string, key: string): string | undefined {
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (line.startsWith("[")) return undefined;
		const entry =
			/^([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\d+))\s*(#.*)?$/.exec(
				line
			);
		if (entry?.[1] === key) return entry[2] ?? entry[3] ?? entry[4];
	}
	return undefined;
}

/** Where a server's own settings put it, which apply when the project file sets nothing. */
interface ServerDefaults {
	readonly host?: string;
	readonly port?: number;
}

export class CoreServeService implements ServeService {
	declare readonly _serviceBrand: undefined;

	private readonly finder: ServerFinder;
	private readonly probe: ServerProbe;
	private readonly records: ServerRecords;

	constructor(
		private readonly configService: ConfigService,
		private readonly fileSystemService: FileSystemService,
		private readonly processService: ProcessService,
		requestService: RequestService,
		private readonly watchService: WatchService,
		private readonly environmentService: EnvironmentService
	) {
		this.finder = new ServerFinder(fileSystemService, processService);
		this.probe = new ServerProbe(requestService);
		this.records = new ServerRecords(
			fileSystemService,
			environmentService.tmpDir
		);
	}

	async prepare(request: ServeRequest): Promise<Result<ServePlan, Error>> {
		const selected = await this.select(request.refs, request.options);
		if (selected.isErr()) return selected;
		const { selection, named } = selected.value;
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const leaves = leafConfigs(configs.value);
		const served = named
			? configs.value.filter(({ file }) => named.has(file))
			: leaves;
		// A name that several servable configs share can't tell which of them a server serves.
		const servable = new Set([...leaves, ...served]);
		const sharedName = (project: string) =>
			[...servable].filter(({ name }) => name === project).length > 1;

		const tool = await this.finder.find(
			selection.home,
			request.server,
			served[0]?.file ?? selection.home
		);
		if (tool.isErr()) return tool;

		const port = tool.value.server.portIn(request.serverArgs);
		if (Number.isNaN(port)) {
			return err(
				new UsageError(
					"The --port after '--' takes a number from 1 to 65535."
				)
			);
		}
		const targets: ServeTarget[] = [];
		for (const config of served)
			targets.push(
				await this.targetOf(config, tool.value, request.serverArgs)
			);

		const clash = this.clashOf(targets, port !== undefined);
		if (clash) return err(clash);

		const checked: ServeTarget[] = [];
		const taken: Diagnostic[] = [];
		for (const target of targets) {
			const state = await this.probe.probe(
				target.address,
				tool.value.server
			);
			if (state.kind === "free") {
				checked.push(target);
				continue;
			}
			const holder = state.kind === "serving" ? state.info : undefined;
			const elsewhere =
				holder && (await this.records.read(target.address, holder));
			const ownServer =
				holder?.project === target.project &&
				!sharedName(target.project) &&
				(!elsewhere ||
					path.resolve(elsewhere.projectFile) ===
						path.resolve(target.config.outFile));
			if (ownServer) checked.push({ ...target, running: holder });
			else
				taken.push(
					await this.portTaken(
						target,
						holder,
						elsewhere
							? path.dirname(elsewhere.projectFile)
							: undefined,
						targets,
						tool.value.server
					)
				);
		}
		if (taken.length > 0) return err(new DiagnosticsError(taken));
		return ok(
			new ServePlan(selection, tool.value, checked, request.serverArgs)
		);
	}

	/** Every config here is watched, so no project file goes stale, and `refs` pick what is served. A named config from elsewhere, or a broken one here, leaves the named configs watched on their own. */
	private async select(
		refs: readonly string[],
		options: ConfigOptionValues
	): Promise<
		Result<
			{
				readonly selection: ConfigSelection;
				readonly named?: ReadonlySet<string>;
			},
			Error
		>
	> {
		const named = await this.configService.select(refs, options);
		if (named.isErr() || refs.length === 0)
			return named.map((selection) => ({ selection }));
		const files = new Set(named.value.entries.map(({ file }) => file));
		const here = await this.configService.select([], options);
		const holdsNamed =
			here.isOk() &&
			here.value.requireValid().isOk() &&
			[...files].every((file) =>
				here.value.entries.some((entry) => entry.file === file)
			);
		return ok({
			selection: holdsNamed ? here.value : named.value,
			named: files,
		});
	}

	serve(plan: ServePlan): Result<ServeSession, DiagnosticsError> {
		const watch = this.watchService.watch(plan.selection);
		if (watch.isErr()) return watch;
		return ok(
			new CoreServeSession(
				plan,
				watch.value,
				this.processService,
				this.probe,
				this.records
			)
		);
	}

	/** The address the server will listen on: the flags after `--`, then the project file, then the server's own settings and defaults. */
	private async targetOf(
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

	private async defaultsOf(
		server: SyncServer,
		projectDir: string
	): Promise<ServerDefaults> {
		for (const file of server.settingsFiles(
			projectDir,
			this.environmentService.userHome
		)) {
			let text: string;
			try {
				if (!(await this.fileSystemService.exists(file))) continue;
				text = await this.fileSystemService.readFile(file);
			} catch {
				continue;
			}
			const port = Number(topLevelValue(text, "port"));
			return {
				host: topLevelValue(text, "host"),
				port: Number.isInteger(port) && port > 0 ? port : undefined,
			};
		}
		return {};
	}

	/** Two targets on one port can't both be served; the command line is what has to change. */
	private clashOf(
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
		const where = config.template
			? `its own servePort in ${path.basename(config.template.file)}`
			: "a template with its own servePort";
		const command = `rogen serve ${config.label} -- --port ${free ?? "<port>"}`;
		return errorDiagnostic(
			"serve.portTaken",
			{ resource: config.template?.file ?? config.file },
			`Port ${address.port} is taken by ${by}, so ${config.label} can't be served there. Give ${config.label} ${where}, or run '${command}'.`,
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
