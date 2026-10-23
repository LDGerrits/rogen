import { Result, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { IndexService } from "../../platform/fs/index-service.js";
import { Watcher } from "../../platform/watcher/watcher.js";
import { WriteSet } from "../write/write.js";
import { WriteService } from "../write/write-service.js";
import { ReloadableSelection } from "../config/config-service.js";
import { CoreWatchSession } from "./core-watch-session.js";
import { WatchOptions, WatchService, WatchSession } from "./watch-service.js";

export class CoreWatchService implements WatchService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly watcher: Watcher,
		private readonly indexService: IndexService,
		private readonly writeService: WriteService
	) {}

	watch(
		selection: ReloadableSelection,
		options?: WatchOptions
	): Result<WatchSession, DiagnosticsError> {
		const set = WriteSet.of(selection);
		if (set.isErr()) return set;

		return ok(
			new CoreWatchSession(
				selection,
				set.value,
				this.watcher,
				this.indexService,
				this.writeService,
				options
			)
		);
	}
}
