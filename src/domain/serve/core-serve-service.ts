import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { RequestService } from "../../platform/request/request-service.js";
import { ConfigOptionValues } from "../config/config.js";
import { ConfigSelection, ConfigService } from "../config/config-service.js";
import { WatchService } from "../watch/watch-service.js";
import { CoreServeSession } from "./core-serve-session.js";
import { ServedConfigs, SyncServer } from "./serve.js";
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
import { ServerRecords } from "./server-record.js";

export class CoreServeService implements ServeService {
	declare readonly _serviceBrand: undefined;

	private readonly finder: ServerFinder;
	private readonly probe: ServerProbe;
	private readonly records: ServerRecords;
	private readonly ports: ServePorts;

	constructor(
		private readonly configService: ConfigService,
		fileSystemService: FileSystemService,
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
		this.ports = new ServePorts(
			fileSystemService,
			this.probe,
			this.records,
			environmentService.userHome
		);
	}

	async prepare(request: ServeRequest): Promise<Result<ServePlan, Error>> {
		const server = CoreServeService.serverOf(request.server);
		if (server.isErr()) return server;
		const selected = await this.select(request.refs, request.options);
		if (selected.isErr()) return selected;
		const { selection, named } = selected.value;
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const servedConfigs = new ServedConfigs(configs.value, named);
		const served = servedConfigs.configs;

		const tool = await this.finder.find(
			selection.home,
			server.value,
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
				await this.ports.targetOf(
					config,
					tool.value,
					request.serverArgs
				)
			);

		const clash = this.ports.clashOf(targets, port !== undefined);
		if (clash) return err(clash);

		const checked: ServeTarget[] = [];
		const taken: Diagnostic[] = [];
		for (const target of targets) {
			const result = await this.ports.check(
				target,
				targets,
				tool.value.server,
				servedConfigs.sharesName(target.project)
			);
			if (result.isOk()) checked.push(result.value);
			else taken.push(result.error);
		}
		if (taken.length > 0) return err(new DiagnosticsError(taken));
		return ok(
			new ServePlan(
				selection,
				tool.value,
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
				this.records,
				this.ports
			)
		);
	}
}
