import { IndexService } from "../../platform/fs/index-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { BuildService } from "../build/build-service.js";
import { ConfigSelection } from "../config/config-service.js";
import { CoreWatchSession } from "./core-watch-session.js";
import { WatchService, WatchSession } from "./watch-service.js";

export class CoreWatchService implements WatchService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly watcher: Watcher,
		private readonly logService: LogService,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService
	) {}

	watch(selection: ConfigSelection): WatchSession {
		return new CoreWatchSession(
			selection,
			this.watcher,
			this.logService,
			this.indexService,
			this.buildService
		);
	}
}
