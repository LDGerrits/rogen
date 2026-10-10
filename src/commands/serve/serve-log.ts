import { toNative } from "../../base/path.js";
import { ConfigNotice } from "../../domain/config/config-service.js";
import {
	ServeChange,
	ServePlan,
	ServeTarget,
	ServerSaid,
	ServerStop,
	ServingServer,
} from "../../domain/serve/serve-service.js";
import { ServerInfo } from "../../domain/serve/serve.js";
import { WatchUpdate } from "../../domain/watch/watch-service.js";
import {
	diagnosticToJson,
	messageRelativeTo,
} from "../../platform/diagnostics/diagnostic.js";
import { failureToJson } from "../../platform/diagnostics/diagnostics-error.js";
import { LogService } from "../../platform/log/log-service.js";
import { buildEntry } from "../build/build-report.js";
import { WatchLog } from "../watch/watch-log.js";

/** Who serves `info`'s project, as a person reads it: `Rojo 7.7.1`. */
const serverOf = (info: ServerInfo) => `${info.server.name} ${info.version}`;

/** What a serve tells its user, as it happens. */
export interface ServeReporter {
	/** Opens the output: the configs served, the server, and those a server already serves. */
	begin(plan: ServePlan): void;
	update(update: WatchUpdate): void;
	serving(serving: ServingServer): void;
	said(said: ServerSaid, plan: ServePlan): void;
	stopped(stop: ServerStop, plan: ServePlan): void;
	/** How the servers followed the configs as they changed. */
	changed(change: ServeChange, plan: ServePlan): void;
	/** Says each server running at the end was stopped because the run was asked to stop. */
	shutdown(plan: ServePlan, targets: readonly ServeTarget[]): void;
	error(error: Error): void;
	/** Ends the output of a run whose errors the lines before already told. */
	abort(error: Error): void;
	end(message: string): void;
}

/** Reports a serve in lines for a person. */
export class ServeLog implements ServeReporter {
	private readonly watchLog: WatchLog;

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {
		this.watchLog = new WatchLog(logService, cwd);
	}

	begin(plan: ServePlan): void {
		const { tool, selection } = plan;
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
		for (const target of plan.running) this.running(target);
	}

	update(update: WatchUpdate): void {
		this.watchLog.update(update);
	}

	serving({ target, info }: ServingServer): void {
		this.logService.success(
			`Serving ${target.config.label} with ${serverOf(info)} at ${target.address}.`
		);
	}

	/** What a server said, as Rogen's own line, with the paths under the working folder relative to it; what Rogen drops shows only with `--verbose`. */
	said(said: ServerSaid, plan: ServePlan): void {
		const { message } = said;
		if (message.severity === "debug") {
			this.logService.debug(`${plan.tool.server.name}: ${message.text}`);
			return;
		}
		const text = `${plan.tool.server.name}: ${messageRelativeTo(message.text, this.cwd)}`;
		if (message.severity === "error") this.logService.error(text);
		else if (message.severity === "warning") this.logService.warn(text);
		else this.logService.info(text);
	}

	stopped(
		{ target, interrupted, failure }: ServerStop,
		plan: ServePlan
	): void {
		if (failure) this.logService.diagnostic(failure);
		else if (!interrupted)
			this.logService.info(
				`${plan.tool.server.name} stopped serving ${target.config.label}.`
			);
	}

	changed(change: ServeChange): void {
		const { target } = change;
		const { label } = target.config;
		switch (change.kind) {
			case "running":
				this.running(target);
				return;
			case "refused":
				this.logService.diagnostic(change.diagnostic);
				return;
			case "retired":
				this.logService.info(
					change.reason === "removed"
						? `Stopped serving ${label}: its config is gone.`
						: change.reason === "extended"
							? `Stopped serving ${label}: a config extends it now, and is served instead.`
							: `Stopped serving ${label} at ${target.address}: its template moved it.`
				);
		}
	}

	shutdown(): void {}

	error(error: Error): void {
		this.logService.error(error.message);
	}

	abort(): void {
		this.logService.closeFrame("serve failed.");
	}

	end(message: string): void {
		this.watchLog.end(message);
	}

	private running(target: ServeTarget): void {
		const info = target.running!;
		this.logService.info(
			`${target.config.label} is already served: ${serverOf(info)} serves a project named ${info.project} at ${target.address}${info.session ? ` (session ${info.session})` : ""}.`
		);
	}
}

/** Reports a serve as one JSON object per line for a program, each keyed by what it reports. */
export class ServeJsonLog implements ServeReporter {
	constructor(private readonly logService: LogService) {}

	begin(plan: ServePlan): void {
		for (const target of plan.running) this.running(target);
	}

	update(update: WatchUpdate): void {
		update.notices.forEach((notice) => this.notice(notice));
		for (const { build } of update.reports)
			this.line({ build: buildEntry(build) });
	}

	serving({ target, info }: ServingServer): void {
		this.line({ serving: this.servingJson(target, info, false) });
	}

	said(said: ServerSaid, plan: ServePlan): void {
		const { target, message } = said;
		if (message.severity === "debug") {
			this.logService.debug(`${plan.tool.server.name}: ${message.text}`);
			return;
		}
		this.line({
			output: {
				config: target.config.label,
				tool: plan.tool.server.id,
				severity: message.severity,
				message: message.text,
			},
		});
	}

	stopped({ target, exit, failure }: ServerStop, plan: ServePlan): void {
		this.line({
			stopped: {
				config: target.config.label,
				tool: plan.tool.server.id,
				reason: "exited",
				code: exit.code,
				signal: exit.signal,
			},
		});
		if (failure) this.line({ diagnostics: [diagnosticToJson(failure)] });
	}

	changed(change: ServeChange, plan: ServePlan): void {
		const { target } = change;
		const { label } = target.config;
		const tool = plan.tool.server.id;
		switch (change.kind) {
			case "running":
				this.running(target);
				return;
			case "refused":
				this.line({
					refused: {
						config: label,
						tool,
						diagnostics: [diagnosticToJson(change.diagnostic)],
					},
				});
				return;
			case "retired":
				this.line({
					stopped: { config: label, tool, reason: change.reason },
				});
		}
	}

	shutdown(plan: ServePlan, targets: readonly ServeTarget[]): void {
		for (const { config } of targets)
			this.line({
				stopped: {
					config: config.label,
					tool: plan.tool.server.id,
					reason: "shutdown",
				},
			});
	}

	error(error: Error): void {
		this.line({ error: error.message });
	}

	abort(error: Error): void {
		this.line(failureToJson(error));
	}

	end(): void {}

	private running(target: ServeTarget): void {
		this.line({
			serving: this.servingJson(target, target.running!, true),
		});
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
