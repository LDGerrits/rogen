import path from "path";
import { InitService } from "../../domain/init/init-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogService } from "../../platform/log/log-service.js";

/** Brings an outdated Rogen block in the repository's agent files up to this version, except under CI, where a changed file would only surprise the pipeline. */
export class RefreshAgentRules {
	constructor(
		@InitService private readonly initService: InitService,
		@LogService private readonly logService: LogService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService
	) {}

	/** Says what it updated, unless the run prints JSON, and returns those files relative to the working folder. */
	async run(json: boolean): Promise<string[]> {
		const { cwd, underCi } = this.environmentService;
		if (underCi) return [];
		const updated = (await this.initService.refreshAgentRules(cwd)).map(
			(file) => path.relative(cwd, file) || file
		);
		if (!json)
			for (const file of updated)
				this.logService.notice(
					`Updated Rogen's rules in ${file} to this version.`
				);
		return updated;
	}
}
