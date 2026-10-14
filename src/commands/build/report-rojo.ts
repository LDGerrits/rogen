import { ServerMessage } from "../../domain/runner/sync-server.js";
import { messageRelativeTo } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** What Rojo said while it built, at the level it said it. */
export function reportRojo(
	logService: LogService,
	messages: readonly ServerMessage[],
	cwd: string
): void {
	for (const { severity, text } of messages) {
		const said = `Rojo: ${messageRelativeTo(text, cwd)}`;
		if (severity === "error") logService.error(said);
		else if (severity === "warning") logService.warn(said);
		else if (severity === "info") logService.info(said);
		else logService.debug(said);
	}
}
