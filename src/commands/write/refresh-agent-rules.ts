import path from "path";
import { InitService } from "../../domain/init/init-service.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";

/** Brings an outdated Rogen block in the repository's agent files up to this version, saying so unless the run prints JSON. */
export async function refreshAgentRules(
	accessor: ServicesAccessor,
	json: boolean
): Promise<void> {
	const { cwd } = accessor.get(EnvironmentService);
	const updated = await accessor.get(InitService).refreshAgentRules(cwd);
	if (json) return;
	for (const file of updated)
		accessor
			.get(LogService)
			.notice(
				`Updated Rogen's rules in ${path.relative(cwd, file) || file} to this version.`
			);
}
