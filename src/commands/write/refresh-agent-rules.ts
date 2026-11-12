import path from "path";
import { InitService } from "../../domain/init/init-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogService } from "../../platform/log/log-service.js";

/** Brings an outdated Rogen block in the repository's agent files up to this version. */
export class RefreshAgentRules {
	constructor(
		@InitService private readonly initService: InitService,
		@LogService private readonly logService: LogService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService
	) {}

	/** Says what it updated, unless the run prints JSON. */
	async run(json: boolean): Promise<void> {
		const { cwd } = this.environmentService;
		const updated = await this.initService.refreshAgentRules(cwd);
		if (json) return;
		for (const file of updated)
			this.logService.notice(
				`Updated Rogen's rules in ${path.relative(cwd, file) || file} to this version.`
			);
	}
}
