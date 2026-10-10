import { toNative } from "../../base/path.js";
import { ConfigNotice } from "../../domain/config/config-service.js";
import {
	ServeChangeEvent,
	ServePlan,
	ServedTarget,
	ServeTarget,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
} from "../../domain/serve/serve-service.js";
import { ServerInfo } from "../../domain/serve/serve.js";
import { WatchUpdate } from "../../domain/watch/watch-service.js";
import { messageRelativeTo } from "../../platform/diagnostics/diagnostic.js";
import { LogService } from "../../platform/log/log-service.js";
import { buildEntry } from "../build/build-report.js";
import { WatchLog } from "../watch/watch-log.js";
import {
	diagnosticToJson,
	diagnosticsJson,
	failureToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

/** Who serves `info`'s project, as a person reads it: `Rojo 7.7.1`. */
const serverOf = (info: ServerInfo) => `${info.server.name} ${info.version}`;

/** What a serve tells its user, as it happens. */
export interface ServeReporter {
	/** Opens the output: the configs served, the server, and those a server already serves. */
	begin(): void;
	update(update: WatchUpdate): void;
	serving(serving: ServerReadyEvent): void;
	said(said: ServerOutputEvent): void;
	stopped(stop: ServerExitEvent): void;
	/** How the servers followed the configs as they changed. */
	changed(change: ServeChangeEvent): void;
	/** Says each server running at the end was stopped because the run was asked to stop. */
	shutdown(targets: readonly ServeTarget[]): void;
	error(error: Error): void;
	/** Ends the output of a run whose errors the lines before already told. */
	abort(error: Error): void;
	end(message: string): void;
}

/** Why a server was stopped on purpose, as the end of a sentence. */
const RETIRED_BECAUSE = {
	removed: "its config is gone",
	extended: "a config extends it now, and is served instead",
	moved: "its template moved it",
} as const;

/** Reports a serve in lines for a person. */
export class ServeLog implements ServeReporter {
	private readonly watchLog: WatchLog;

	constructor(
		private readonly logService: LogService,
		private readonly cwd: string,
		private readonly plan: ServePlan
	) {
		this.watchLog = new WatchLog(logService, cwd, "serve");
	}

	begin(): void {
		const { plan } = this;
		const { executable: tool, selection } = plan;
		this.watchLog.begin(
			plan.targets.map(({ config }) => config),
			selection.home
		);
		if (tool.passedOver) {
			this.logService.info(
				`Both ${tool.server.id} and ${tool.passedOver.id} are pinned; serving with ${tool.server.id} (--tool ${tool.passedOver.id} to switch).`
			);
		}
		for (const target of plan.alreadyServed) this.running(target);
	}

	update(update: WatchUpdate): void {
		this.watchLog.update(update);
	}

	serving({ target, info }: ServerReadyEvent): void {
		this.logService.success(
			`Serving ${target.config.label} with ${serverOf(info)} at ${target.address}.`
		);
	}

	/** What a server said, as Rogen's own line, with the paths under the working folder relative to it; what Rogen drops shows only with `--verbose`. */
	said(said: ServerOutputEvent): void {
		const { plan } = this;
		const { message } = said;
		if (message.severity === "debug") {
			this.logService.debug(
				`${plan.executable.server.name}: ${message.text}`
			);
			return;
		}
		const text = `${plan.executable.server.name}: ${messageRelativeTo(message.text, this.cwd)}`;
		if (message.severity === "error") this.logService.error(text);
		else if (message.severity === "warning") this.logService.warn(text);
		else this.logService.info(text);
	}

	stopped({ target, interrupted, failure }: ServerExitEvent): void {
		if (failure) this.logService.diagnostic(failure);
		else if (!interrupted)
			this.logService.info(
				`${this.plan.executable.server.name} stopped serving ${target.config.label}.`
			);
	}

	changed(change: ServeChangeEvent): void {
		const { target } = change;
		const { label } = target.config;
		switch (change.kind) {
			case "servedElsewhere":
				this.running(change.target);
				return;
			case "refused":
				this.logService.diagnostic(change.diagnostic);
				return;
			case "retired":
				this.logService.info(
					`Stopped serving ${label}${change.reason === "moved" ? ` at ${target.address}` : ""}: ${RETIRED_BECAUSE[change.reason]}.`
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

	private running(target: ServedTarget): void {
		const { servedBy: info } = target;
		this.logService.info(
			`${target.config.label} is already served: ${serverOf(info)} serves a project named ${info.project} at ${target.address}${info.session ? ` (session ${info.session})` : ""}.`
		);
	}
}

/** Reports a serve as one JSON object per line for a program, each keyed by what it reports. */
export class ServeJsonLog implements ServeReporter {
	constructor(
		private readonly logService: LogService,
		private readonly plan: ServePlan
	) {}

	begin(): void {
		for (const target of this.plan.alreadyServed) this.running(target);
	}

	update(update: WatchUpdate): void {
		update.notices.forEach((notice) => this.notice(notice));
		for (const { build } of update.reports)
			this.line({ build: buildEntry(build) });
	}

	serving({ target, info }: ServerReadyEvent): void {
		this.line({ serving: this.servingJson(target, info, false) });
	}

	said(said: ServerOutputEvent): void {
		const { plan } = this;
		const { target, message } = said;
		if (message.severity === "debug") {
			this.logService.debug(
				`${plan.executable.server.name}: ${message.text}`
			);
			return;
		}
		this.line({
			output: {
				config: target.config.label,
				tool: plan.executable.server.id,
				severity: message.severity,
				message: message.text,
			},
		});
	}

	stopped({ target, exit, failure }: ServerExitEvent): void {
		const { plan } = this;
		this.line({
			stopped: {
				config: target.config.label,
				tool: plan.executable.server.id,
				reason: "exited",
				code: exit.code,
				signal: exit.signal,
			},
		});
		if (failure) this.line(diagnosticsJson([failure]));
	}

	changed(change: ServeChangeEvent): void {
		const { target } = change;
		const { label } = target.config;
		const tool = this.plan.executable.server.id;
		switch (change.kind) {
			case "servedElsewhere":
				this.running(change.target);
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

	shutdown(targets: readonly ServeTarget[]): void {
		for (const { config } of targets)
			this.line({
				stopped: {
					config: config.label,
					tool: this.plan.executable.server.id,
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

	private running(target: ServedTarget): void {
		this.line({
			serving: this.servingJson(target, target.servedBy, true),
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
