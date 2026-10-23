import { messageRelativeTo } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { ServerMessage } from "../../domain/runner/rojo-server.js";

/** One thing Rojo said, at the level it said it. */
function reportServerMessage(
	logService: LogService,
	{ severity, text }: ServerMessage,
	cwd: string
): void {
	if (severity === "debug") {
		logService.debug(`Rojo: ${text}`);
		return;
	}
	const said = `Rojo: ${messageRelativeTo(text, cwd)}`;
	if (severity === "error") logService.error(said);
	else if (severity === "warning") logService.warn(said);
	else logService.info(said);
}

/** A line Rojo printed on stdout comes out on stdout as it printed it, so a program that reads its output reads Rogen's; in a frame it is an `info` line, or `debug` when Rogen drops it as noise, so the frame stays whole. */
export function reportServerOutput(
	logService: LogService,
	message: ServerMessage,
	cwd: string
): void {
	if (!logService.framed && message.stdout !== undefined)
		logService.print(message.stdout);
	else if (message.text !== "") reportServerMessage(logService, message, cwd);
}

/** What Rojo said while it ran. */
export function reportRojo(
	logService: LogService,
	messages: readonly ServerMessage[],
	cwd: string
): void {
	for (const message of messages) {
		reportServerOutput(logService, message, cwd);
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
