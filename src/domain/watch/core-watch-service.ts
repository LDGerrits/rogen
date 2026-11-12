import { Result, ok } from "../../base/result.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { WriteSet } from "../write/write.js";
import { ReloadableSelection } from "../config/config-service.js";
import { CoreWatchSession } from "./core-watch-session.js";
import { WatchService, WatchSession } from "./watch-service.js";
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";

export class CoreWatchService implements WatchService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@InstantiationService
		private readonly instantiationService: InstantiationService
	) {}

	watch(
		selection: ReloadableSelection
	): Result<WatchSession, DiagnosticsError> {
		const set = WriteSet.of(selection);
		if (set.isErr()) return set;

		return ok(
			this.instantiationService.createInstance(
				CoreWatchSession,
				selection,
				set.value
			)
		);
	}
}
