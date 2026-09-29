import { IndexService } from "../../platform/fs/index-service.js";
import { ReconciliationService } from "../../platform/watcher/reconciliation-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { BuildService } from "../build/build-service.js";
import { ConfigService } from "../config/config-service.js";
import { OutputService } from "../output/output-service.js";
import { WatchSession } from "./watch-session.js";
import { WatchService } from "./watch-service.js";

export class CoreWatchService implements WatchService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly watcher: Watcher,
		private readonly reconciliationService: ReconciliationService,
		private readonly configService: ConfigService,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService,
		private readonly outputService: OutputService
	) {}

	watch(): WatchSession {
		return new WatchSession(
			this.watcher,
			this.reconciliationService,
			this.configService,
			this.indexService,
			this.buildService,
			this.outputService
		);
	}
}
