import { Result, err, ok } from "../../base/result.js";
import { Diagnostic } from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RequestService } from "../../platform/request/request-service.js";

import { ConfigService } from "../config/config-service.js";
import { ProjectChoice } from "../config/project-choice.js";
import { WatchService } from "../watch/watch-service.js";
import { CoreServeSession } from "./core-serve-session.js";
import { RojoCompatibility } from "../runner/rojo-compatibility.js";
import { RojoRunner } from "../runner/rojo-runner.js";
import { SyncServer } from "../runner/sync-server.js";
import { ServePorts, namesakesOf } from "./serve-ports.js";
import {
	ServePlan,
	ServeRequest,
	ServeService,
	ServeSession,
	ServeTarget,
	ServingNow,
} from "./serve-service.js";
import { ServedProjectFiles } from "./served-project-files.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";

export class CoreServeService implements ServeService {
	declare readonly _serviceBrand: undefined;

	private readonly probe: ServerProbe;
	private readonly records: ServerRecords;
	private readonly served: ServedProjectFiles;

	constructor(
		private readonly configService: ConfigService,
		private readonly fileSystemService: FileSystemService,
		private readonly rojoRunner: RojoRunner,
		requestService: RequestService,
		private readonly watchService: WatchService,
		private readonly environmentService: EnvironmentService,
		private readonly compatibility = new RojoCompatibility(
			fileSystemService
		)
	) {
		this.probe = new ServerProbe(requestService);
		this.records = new ServerRecords(
			fileSystemService,
			environmentService.tmpDir
		);
		this.served = new ServedProjectFiles(this.records, this.probe);
	}

	private portsFor(
		server: SyncServer,
		serverArgs: readonly string[]
	): ServePorts {
		return new ServePorts(
			this.probe,
			this.records,
			server,
			serverArgs,
			this.environmentService.cwd
		);
	}

	async prepare(request: ServeRequest): Promise<Result<ServePlan, Error>> {
		const selected = await this.configService.select(request.refs);
		if (selected.isErr()) return selected;
		const selection = selected.value;
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const served = ProjectChoice.served(configs.value, selection.named);
		const executable = await this.rojoRunner.find(
			selection.home,
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
		for (const config of served) targets.push(ports.targetOf(config));

		const oneProject = ports.oneProjectError(targets);
		if (oneProject) return err(oneProject);
		const clash = ports.clashOf(targets);
		if (clash) return err(clash);

		const checked: ServeTarget[] = [];
		const taken: Diagnostic[] = [];
		for (const target of targets) {
			const result = await ports.check(
				target,
				targets,
				namesakesOf(target.config, served)
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
				request.serverArgs
			)
		);
	}

	serve(plan: ServePlan): Result<ServeSession, DiagnosticsError> {
		const watch = this.watchService.watch(plan.selection);
		if (watch.isErr()) return watch;
		return ok(
			new CoreServeSession(
				plan,
				watch.value,
				this.rojoRunner,
				this.probe,
				this.records,
				this.portsFor(plan.executable.server, plan.serverArgs),
				this.compatibility
			)
		);
	}

	async servedBy(
		projectFiles: readonly string[]
	): Promise<ReadonlyMap<string, ServingNow>> {
		const found = new Map<string, ServingNow>();
		for (const [file, record] of await this.served.serving(projectFiles)) {
			const server = SyncServer.byId(record.server);
			if (server)
				found.set(file, {
					server,
					host: record.host,
					port: record.port,
					clients: record.clients,
				});
		}
		return found;
	}
}
