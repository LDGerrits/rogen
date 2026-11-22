import path from "path";
import { InitService } from "../../domain/init/init-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { agentRulesLine } from "./write-document.js";

export type AgentRulesOutput = "text" | "document" | "lines";

export class RefreshAgentRules {
	constructor(
		@InitService private readonly initService: InitService,
		@LogService private readonly logService: LogService,
		@EnvironmentService
		private readonly environmentService: EnvironmentService
	) {}

	async run(output: AgentRulesOutput): Promise<string[]> {
		const { cwd, isCi } = this.environmentService;
		if (isCi) return [];
		const updated = (await this.initService.refreshAgentRules(cwd)).map(
			(file) => path.relative(cwd, file)
		);
		const line = agentRulesLine(updated);
		if (output === "lines" && line)
			this.logService.print(JSON.stringify(line));
		if (output === "text")
			for (const file of updated)
				this.logService.notice(
					`Updated ${file} to this version of Rogen.`
				);
		return updated;
	}
}
