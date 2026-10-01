import { IndexService } from "../../platform/fs/index-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { BuildService } from "../build/build-service.js";
import { ConfigService } from "../config/config-service.js";
import { CoreWatchSession } from "./core-watch-session.js";
import { WatchService, WatchSession } from "./watch-service.js";

export class CoreWatchService implements WatchService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly watcher: Watcher,
		private readonly logService: LogService,
		private readonly configService: ConfigService,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService
	) {}

	watch(): WatchSession {
		return new CoreWatchSession(
			this.watcher,
			this.logService,
			this.configService,
			this.indexService,
			this.buildService
		);
	}
}
