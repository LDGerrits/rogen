import path from "path";
import { relativeTo } from "../../base/path.js";
import { messageRelativeTo } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { RojoServer, ServerMessage } from "../../domain/runner/rojo-server.js";
import { RojoTarget } from "./rojo-entry.js";

function reportServerMessage(
	logService: LogService,
	{ severity, text, details = [], stdout }: ServerMessage,
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
	else if (stdout === undefined) logService.notice(said);
	else logService.info(said);
}

const isProgress = ({ severity, text }: ServerMessage) =>
	severity === "info" && RojoServer.isProgress(text);

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
