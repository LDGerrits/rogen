import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogLevel } from "../../platform/log/log-service.js";

export class UpdateSwitch {
	constructor(
		@EnvironmentService
		private readonly environmentService: EnvironmentService
	) {}

	/**
	 * Off for a script, CI, `--json` and `--quiet`, and for the two variables
	 * people set to opt out (the second is the `update-notifier` convention).
	 */
	get isOn(): boolean {
		const { environmentService } = this;
		const optOut = environmentService
			.readVariable("ROGEN_NO_UPDATE_CHECK")
			?.toLowerCase();
		return (
			environmentService.isInteractive &&
			!environmentService.isPlain &&
			environmentService.logLevel > LogLevel.Error &&
			(optOut === undefined ||
				optOut === "" ||
				optOut === "0" ||
				optOut === "false") &&
			!environmentService.readVariable("NO_UPDATE_NOTIFIER")
		);
	}
}
