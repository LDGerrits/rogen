import { UsageError } from "../../base/errors.js";
import { PathSet } from "../../base/path.js";
import { closestMatch, joinedWithAnd } from "../../base/strings.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { RequestService } from "../../platform/request/request-service.js";

import { ResolvedConfig } from "../config/config.js";
import {
	ConfigOptionValues,
	ReloadableSelection,
	ConfigService,
} from "../config/config-service.js";
import { WatchService } from "../watch/watch-service.js";
import { CoreServeSession } from "./core-serve-session.js";
import { SyncServer } from "./serve.js";
import { ServePorts } from "./serve-ports.js";
import {
	ServePlan,
	ServeRequest,
	ServeService,
	ServeSession,
	ServeTarget,
} from "./serve-service.js";
import { ServerFinder } from "./server-finder.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";
import { ServedConfigs } from "./served-configs.js";

export class CoreServeService implements ServeService {
	declare readonly _serviceBrand: undefined;

	private readonly finder: ServerFinder;
	private readonly probe: ServerProbe;
	private readonly records: ServerRecords;
	private readonly userHome: string;

	constructor(
		private readonly configService: ConfigService,
		private readonly fileSystemService: FileSystemService,
		private readonly processService: ProcessService,
		requestService: RequestService,
		private readonly watchService: WatchService,
		environmentService: EnvironmentService
	) {
		this.finder = new ServerFinder(fileSystemService, processService);
		this.probe = new ServerProbe(requestService);
		this.records = new ServerRecords(
			fileSystemService,
			environmentService.tmpDir
		);
		this.userHome = environmentService.userHome;
	}

	/** The ports of a serve of `server`, which gets `serverArgs` as they are. */
	private portsFor(
		server: SyncServer,
		serverArgs: readonly string[]
	): ServePorts {
		return new ServePorts(
			this.fileSystemService,
			this.probe,
			this.records,
			this.userHome,
			server,
			serverArgs
		);
	}

	async prepare(request: ServeRequest): Promise<Result<ServePlan, Error>> {
		const asked = CoreServeService.serverOf(request.serverId);
		if (asked.isErr()) return asked;
		const selected = await this.select(request.refs, request.options);
		if (selected.isErr()) return selected;
		const { selection, named, neighbours } = selected.value;
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const servedConfigs = new ServedConfigs(
			configs.value,
			named,
			neighbours
		);
		const served = servedConfigs.configs;
		const server = asked.value
			? ok(asked.value)
			: CoreServeService.serverNamedBy(served);
		if (server.isErr()) return server;

		const executable = await this.finder.find(
			selection.home,
			server.value,
			served[0]?.file ?? selection.home,
			request.signal
		);
		if (executable.isErr()) return executable;

		const ports = this.portsFor(
			executable.value.server,
			request.serverArgs
		);
		if (ports.portError) return err(ports.portError);
		const targets: ServeTarget[] = [];
		for (const config of served) targets.push(await ports.targetOf(config));

		const clash = ports.clashOf(targets);
		if (clash) return err(clash);

		const checked: ServeTarget[] = [];
		const taken: Diagnostic[] = [];
		for (const target of targets) {
			const result = await ports.check(
				target,
				targets,
				servedConfigs.namesakesOf(target.config)
			);
			if (result.isOk()) checked.push(result.value);
			else taken.push(result.error);
		}
		if (taken.length > 0) return err(new DiagnosticsError(taken));
		return ok(
			new ServePlan(
				selection,
				executable.value,
				checked,
				request.serverArgs,
				named,
				neighbours,
				request.serverId !== undefined
			)
		);
	}

	private static serverOf(
		id: string | undefined
	): Result<SyncServer | undefined, UsageError> {
		if (id === undefined) return ok(undefined);
		const server = SyncServer.byId(id);
		if (server) return ok(server);
		const ids = SyncServer.ALL.map(({ id }) => id);
		const suggestion = closestMatch(id, ids);
		return err(
			new UsageError(
				`--server takes ${ids.join(" or ")}, not "${id}".` +
					(suggestion ? ` Did you mean "${suggestion}"?` : "")
			)
		);
	}

	/** The server the configs to serve name in their "server" field, when they do; one serve runs one server, so they may not name two. */
	private static serverNamedBy(
		configs: readonly ResolvedConfig[]
	): Result<SyncServer | undefined, UsageError> {
		const byServer = new Map<string, string[]>();
		for (const { server, label } of configs) {
			if (server === undefined) continue;
			const labels = byServer.get(server) ?? [];
			labels.push(label);
			byServer.set(server, labels);
		}
		const named = [...byServer];
		if (named.length === 0) return ok(undefined);
		if (named.length === 1) return ok(SyncServer.byId(named[0][0]));
		const lines = named.map(
			([id, labels]) =>
				`${joinedWithAnd(labels)} ${labels.length === 1 ? "names" : "name"} "server": "${id}".`
		);
		const fix = `One serve runs one server: give them the same "server", or serve one at a time, as 'rogen serve ${named[0][1][0]}'.`;
		return err(new UsageError([...lines, fix].join("\n")));
	}

	/** Every config here is watched, so no project file goes stale, and `refs` pick what is served. A named config from elsewhere, or a broken one here, leaves the named configs watched on their own. */
	private async select(
		refs: readonly string[],
		options: ConfigOptionValues
	): Promise<
		Result<
			{
				readonly selection: ReloadableSelection;
				readonly named?: PathSet;
				readonly neighbours: readonly ResolvedConfig[];
			},
			Error
		>
	> {
		const named = await this.configService.select(refs, options);
		if (named.isErr() || refs.length === 0)
			return named.map((selection) => ({ selection, neighbours: [] }));
		const files = named.value.entries.map(({ file }) => file);
		const filesNamed = new PathSet(files);
		const here = await this.configService.select([], options);
		const held = new PathSet(
			here.isOk() ? here.value.entries.map(({ file }) => file) : []
		);
		const holdsNamed =
			here.isOk() &&
			here.value.requireValid().isOk() &&
			files.every((file) => held.has(file));
		if (holdsNamed)
			return ok({
				selection: here.value,
				named: filesNamed,
				neighbours: [],
			});
		return ok({
			selection: named.value,
			named: filesNamed,
			neighbours: await this.neighboursOf(named.value, options),
		});
	}

	/** The configs in the working folder that `selection` leaves out, read without the `-o` that names one config. */
	private async neighboursOf(
		selection: ReloadableSelection,
		options: ConfigOptionValues
	): Promise<ResolvedConfig[]> {
		const everyone = await this.configService.select([], {
			...options,
			"out-file": undefined,
		});
		if (everyone.isErr()) return [];
		const chosen = new PathSet(selection.entries.map(({ file }) => file));
		return everyone.value.configs.filter(({ file }) => !chosen.has(file));
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
				this.records,
				this.portsFor(plan.executable.server, plan.serverArgs)
			)
		);
	}
}
