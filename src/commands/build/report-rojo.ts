import { ServerMessage } from "../../domain/runner/sync-server.js";
import { messageRelativeTo } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";

/** One thing `name`, a Rojo or another server, said, at the level it said it. */
export function reportServerMessage(
	logService: LogService,
	name: string,
	{ severity, text }: ServerMessage,
	cwd: string
): void {
	if (severity === "debug") {
		logService.debug(`${name}: ${text}`);
		return;
	}
	const said = `${name}: ${messageRelativeTo(text, cwd)}`;
	if (severity === "error") logService.error(said);
	else if (severity === "warning") logService.warn(said);
	else logService.info(said);
}

/** What Rojo said while it ran: a line it printed on stdout comes out on stdout as it printed it, so a program that reads Rojo's output reads Rogen's. */
export function reportRojo(
	logService: LogService,
	messages: readonly ServerMessage[],
	cwd: string
): void {
	for (const message of messages) {
		if (message.stdout !== undefined) logService.print(message.stdout);
		else reportServerMessage(logService, "Rojo", message, cwd);
	}
}

/** What Rojo said that its failure doesn't repeat: the failure carries its errors. */
export function reportRojoBesideFailure(
	logService: LogService,
	messages: readonly ServerMessage[],
	cwd: string
): void {
	reportRojo(
		logService,
		messages.filter(({ severity }) => severity !== "error"),
		cwd
	);
}
