import path from "path";
import { relativeTo } from "../../base/path.js";
import { messageRelativeTo } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { RojoServer, ServerMessage } from "../../domain/runner/rojo-server.js";
import { RojoTarget } from "./rojo-entry.js";

/** One thing Rojo said, at the level it said it. */
function reportServerMessage(
	logService: LogService,
	{ severity, text, details = [] }: ServerMessage,
	cwd: string
): void {
	if (severity === "debug") {
		logService.debug(`Rojo: ${text}`);
		return;
	}
	const said = [
		`Rojo: ${messageRelativeTo(text, cwd)}`,
		...details.map((detail) => `  ${messageRelativeTo(detail, cwd)}`),
	].join("\n");
	if (severity === "error") logService.error(said);
	else if (severity === "warning") logService.warn(said);
	else logService.info(said);
}

// Rojo's progress lines, which the line Rogen closes with says again.
const isProgress = ({ severity, text }: ServerMessage) =>
	severity === "info" && RojoServer.isProgress(text);

/** What Rojo said while it ran: its progress lines only under `-v`, everything else in Rogen's style. */
export function reportRojo(
	logService: LogService,
	messages: readonly ServerMessage[],
	cwd: string
): void {
	for (const message of messages) {
		if (isProgress(message)) logService.debug(`Rojo: ${message.text}`);
		else if (message.text !== "")
			reportServerMessage(logService, message, cwd);
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

/** What Rojo made, as the line that closes the run says it, such as `Built game.rbxl`. */
export function rojoDone(target: RojoTarget, cwd: string): string {
	const named = (file: string) =>
		relativeTo(cwd, path.resolve(target.cwd, file));
	switch (target.command) {
		case "build":
			return target.plugin !== undefined
				? `Built plugin ${target.plugin}`
				: `Built ${named(target.output ?? ".")}`;
		case "sourcemap":
			return target.output !== undefined
				? `Wrote ${named(target.output)}`
				: "Wrote the sourcemap";
		case "upload":
			return target.asset !== undefined
				? `Uploaded to asset ${target.asset}`
				: "Uploaded";
	}
}
