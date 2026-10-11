import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { RequestService } from "../../platform/request/request-service.js";

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
		const server = CoreServeService.serverOf(request.serverId);
		if (server.isErr()) return server;
		const selected = await this.select(request.refs, request.options);
		if (selected.isErr()) return selected;
		const { selection, named } = selected.value;
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const servedConfigs = new ServedConfigs(configs.value, named);
		const served = servedConfigs.configs;

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
				servedConfigs.sharesName(target.project)
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
				named
			)
		);
	}

	private static serverOf(
		id: string | undefined
	): Result<SyncServer | undefined, UsageError> {
		if (id === undefined) return ok(undefined);
		const server = SyncServer.byId(id);
		return server
			? ok(server)
			: err(
					new UsageError(
						`--tool takes ${SyncServer.ALL.map(({ id }) => id).join(" or ")}, not "${id}".`
					)
				);
	}

	/** Every config here is watched, so no project file goes stale, and `refs` pick what is served. A named config from elsewhere, or a broken one here, leaves the named configs watched on their own. */
	private async select(
		refs: readonly string[],
		options: ConfigOptionValues
	): Promise<
		Result<
			{
				readonly selection: ReloadableSelection;
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
				this.records,
				this.portsFor(plan.executable.server, plan.serverArgs)
			)
		);
	}
}
