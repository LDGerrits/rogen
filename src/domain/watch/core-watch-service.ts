import { Result, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { BuildSet } from "../build/build.js";
import { BuildService } from "../build/build-service.js";
import { ReloadableSelection } from "../config/config-service.js";
import { CoreWatchSession } from "./core-watch-session.js";
import { WatchService, WatchSession } from "./watch-service.js";

export class CoreWatchService implements WatchService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly watcher: Watcher,
		private readonly indexService: IndexService,
		private readonly buildService: BuildService
	) {}

	watch(
		selection: ReloadableSelection
	): Result<WatchSession, DiagnosticsError> {
		const set = BuildSet.of(selection);
		if (set.isErr()) return set;

		return ok(
			new CoreWatchSession(
				selection,
				set.value,
				this.watcher,
				this.indexService,
				this.buildService
			)
		);
	}
}
