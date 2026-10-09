import path from "path";
import { toNative } from "../../base/path.js";
import { ConfigNotice } from "../../domain/config/config-service.js";
import {
	ServePlan,
	ServeTarget,
	ServerSaid,
	ServerStop,
	ServingServer,
} from "../../domain/serve/serve-service.js";
import { ServerInfo } from "../../domain/serve/serve.js";
import { WatchUpdate } from "../../domain/watch/watch-service.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic.js";
import {
	DiagnosticsError,
	failureToJson,
} from "../../platform/diagnostics/diagnostics-error.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildReport } from "../build/build-report.js";
import { WatchLog } from "../watch/watch-log.js";

/** Who serves `info`'s project, as a person reads it: `Rojo 7.7.1`. */
const serverOf = (info: ServerInfo) => `${info.server.name} ${info.version}`;

/** How `serve` reports: lines for a person, or one JSON object per line for a program, each keyed by what it reports. */
export class ServeLog {
	private readonly watchLog: WatchLog;

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string,
		private readonly json: boolean
	) {
		this.watchLog = new WatchLog(logService, cwd);
	}

	/** Opens the output: the configs served, the server, and those a server already serves. */
	begin(plan: ServePlan): void {
		const { tool, selection } = plan;
		if (!this.json) {
			this.watchLog.begin(
				plan.targets.map(({ config }) => config),
				selection.home,
				"serve"
			);
			if (tool.passedOver) {
				this.logService.info(
					`Both ${tool.server.id} and ${tool.passedOver.id} are pinned; serving with ${tool.server.id} (--tool ${tool.passedOver.id} to switch).`
				);
			}
		}
		for (const target of plan.running) this.running(target);
	}

	update(update: WatchUpdate): void {
		if (!this.json) {
			this.watchLog.update(update);
			return;
		}
		update.notices.forEach((notice) => this.notice(notice));
		for (const { build } of update.reports)
			this.line({ build: BuildReport.entry(build) });
	}

	serving({ target, info }: ServingServer): void {
		if (this.json) {
			this.line({ serving: this.servingJson(target, info, false) });
			return;
		}
		this.logService.success(
			`Serving ${target.config.label} with ${serverOf(info)} at ${target.address}.`
		);
	}

	/** What a server said, as Rogen's own line, with the paths under the working folder relative to it; what Rogen drops shows only with `--verbose`. */
	said({ target, message }: ServerSaid, plan: ServePlan): void {
		const { server } = plan.tool;
		if (message.severity === "debug") {
			this.logService.debug(`${server.name}: ${message.text}`);
			return;
		}
		if (this.json) {
			this.line({
				output: {
					config: target.config.label,
					tool: server.id,
					severity: message.severity,
					message: message.text,
				},
			});
			return;
		}
		const text = `${server.name}: ${message.text.split(this.cwd + path.sep).join("")}`;
		if (message.severity === "error") this.logService.error(text);
		else if (message.severity === "warning") this.logService.warn(text);
		else this.logService.info(text);
	}

	stopped(
		{ target, exit, interrupted, failure }: ServerStop,
		plan: ServePlan
	): void {
		const { server } = plan.tool;
		if (this.json) {
			this.line({
				stopped: {
					config: target.config.label,
					tool: server.id,
					reason: "exited",
					code: exit.code,
					signal: exit.signal,
				},
			});
			if (failure)
				this.line({ diagnostics: [diagnosticToJson(failure)] });
			return;
		}
		if (failure) this.logService.diagnostic(failure);
		else if (!interrupted)
			this.logService.info(
				`${server.name} stopped serving ${target.config.label}.`
			);
	}

	/** Says each server it started was stopped because the run was asked to stop. */
	shutdown(plan: ServePlan): void {
		if (!this.json) return;
		for (const { config } of plan.toStart)
			this.line({
				stopped: {
					config: config.label,
					tool: plan.tool.server.id,
					reason: "shutdown",
				},
			});
	}

	error(error: Error): void {
		if (this.json) this.line({ error: error.message });
		else this.logService.error(error.message);
	}

	/** A failure that ends the run; `shown` when the lines before already said what it holds. */
	failure(error: Error, shown = false): void {
		if (this.json) {
			this.line(failureToJson(error));
			return;
		}
		if (!shown && error instanceof DiagnosticsError)
			error.diagnostics.forEach((diagnostic) =>
				this.logService.diagnostic(diagnostic)
			);
		else if (!shown) this.logService.error(error.message);
		this.logService.closeFrame("serve failed.");
	}

	end(message: string): void {
		if (!this.json) this.watchLog.end(message);
	}

	private running(target: ServeTarget): void {
		const info = target.running!;
		if (this.json) {
			this.line({ serving: this.servingJson(target, info, true) });
			return;
		}
		this.logService.info(
			`${target.config.label} is already served: ${serverOf(info)} serves a project named ${info.project} at ${target.address}${info.session ? ` (session ${info.session})` : ""}.`
		);
	}

	private notice(notice: ConfigNotice): void {
		this.line({
			notice: {
				kind: notice.kind,
				file: toNative(notice.file),
				...(notice.kind === "broken" && {
					keptLastValid: notice.keptLastValid,
					diagnostics: notice.errors.map(diagnosticToJson),
				}),
			},
		});
	}

	private servingJson(
		target: ServeTarget,
		info: ServerInfo,
		alreadyRunning: boolean
	): Record<string, unknown> {
		return {
			config: target.config.label,
			tool: info.server.id,
			version: info.version,
			project: info.project,
			host: target.address.host,
			port: target.address.port,
			...(info.session && { session: info.session }),
			...(alreadyRunning && { alreadyRunning }),
		};
	}

	private line(value: unknown): void {
		this.logService.print(JSON.stringify(value));
	}
}
