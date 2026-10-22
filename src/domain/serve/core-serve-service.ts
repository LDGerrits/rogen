import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { FileSystemService } from "../../platform/fs/file-system-service.js";
import { RequestService } from "../../platform/request/request-service.js";

import { ConfigService } from "../config/config-service.js";
import { WatchService } from "../watch/watch-service.js";
import { CoreServeSession } from "./core-serve-session.js";
import { RojoCompatibility } from "../runner/rojo-compatibility.js";
import { RojoRunner } from "../runner/rojo-runner.js";
import { ServeFlags } from "../runner/serve-flags.js";
import { ServePorts } from "./serve-ports.js";
import {
	ServePlan,
	ServeRequest,
	ServeService,
	ServeSession,
} from "./serve-service.js";
import { ServerProbe } from "./server-probe.js";
import { ServerRecords } from "./server-records.js";

export class CoreServeService implements ServeService {
	declare readonly _serviceBrand: undefined;

	private readonly probe: ServerProbe;
	private readonly records: ServerRecords;

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
			environmentService.tmpDir,
			environmentService.pid
		);
	}

	private portsFor(serverArgs: readonly string[]): ServePorts {
		return new ServePorts(
			this.probe,
			this.records,
			serverArgs,
			this.environmentService.cwd,
			this.rojoRunner
		);
	}

	async prepare(request: ServeRequest): Promise<Result<ServePlan, Error>> {
		const selected = await this.configService.select(request.refs);
		if (selected.isErr()) return selected;
		const selection = selected.value;
		const configs = selection.requireValid();
		if (configs.isErr()) return configs;
		const [config] = configs.value;
		const executable = await this.rojoRunner.find(
			selection.home,
			config.file,
			request.signal
		);
		if (executable.isErr()) return executable;
		const { version } = executable.value;
		const tooNew = ServeFlags.tooNewIn(request.serverArgs, version);
		if (tooNew)
			return err(
				new UsageError(
					`${tooNew.flag} needs Rojo ${tooNew.since} or later, and the Rojo that runs here is ${version}.`,
					`Change your Rojo pin to ${tooNew.since} or later, or update the Rojo on the PATH, or leave the flag out.`
				)
			);

		const ports = this.portsFor(request.serverArgs);
		if (ports.portError) return err(ports.portError);
		const checked = await ports.check(ports.targetOf(config));
		if (checked.isErr()) return err(new DiagnosticsError([checked.error]));
		return ok(
			new ServePlan(
				selection,
				executable.value,
				checked.value,
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
				this.portsFor(plan.serverArgs),
				this.compatibility
			)
		);
	}
}
