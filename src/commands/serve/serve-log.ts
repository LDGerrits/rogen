import {
	ServeChangeEvent,
	ServePlan,
	ServedTarget,
	ServeTarget,
	ServerConnectionEvent,
	ServerOutputEvent,
	ServerExitEvent,
	ServerReadyEvent,
	isServed,
} from "../../domain/serve/serve-service.js";
import { ServerInfo, SyncServer } from "../../domain/runner/sync-server.js";
import { WatchUpdate } from "../../domain/watch/watch-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { OutputShape } from "../../platform/output/output-shape.js";
import { watchLineShapes } from "../build/build-document.js";
import { reportServerOutput } from "../build/report-rojo.js";
import { WatchJsonLog, WatchLog } from "../build/watch-log.js";
import {
	diagnosticShape,
	diagnosticToJson,
	diagnosticsJson,
	failureToJson,
} from "../../platform/diagnostics/diagnostic-json.js";

const S = OutputShape;

const serverEventFields = { config: S.string, server: S.string };

const connectionFields = {
	...serverEventFields,
	project: S.string,
	port: S.integer,
};

/** One line of `serve --json`. */
export const serveLineShape = S.union(
	watchLineShapes.build,
	watchLineShapes.notice,
	watchLineShapes.error,
	S.object({
		serving: S.object({
			...serverEventFields,
			version: S.string,
			project: S.string,
			host: S.string,
			port: S.integer,
			session: S.optional(S.string),
			reportsConnections: S.boolean,
			alreadyRunning: S.optional(S.boolean),
		}),
	}),
	S.object({
		connected: S.object({ ...connectionFields, clients: S.integer }),
	}),
	S.object({
		disconnected: S.object({ ...connectionFields, clients: S.integer }),
	}),
	S.object({
		output: S.object({
			...serverEventFields,
			severity: S.enum("error", "warning", "info"),
			message: S.string,
		}),
	}),
	S.object({
		refused: S.object({
			...serverEventFields,
			diagnostics: S.array(diagnosticShape),
		}),
	}),
	S.object({
		stopped: S.object({
			...serverEventFields,
			reason: S.enum("exited", "removed", "moved", "shutdown"),
			code: S.optional(S.nullable(S.integer)),
			signal: S.optional(S.nullable(S.string)),
		}),
	})
);

const serverOf = (info: ServerInfo) => `${info.server.name} ${info.version}`;

export interface ServeReporter {
	begin(): void;
	update(update: WatchUpdate): void;
	serving(serving: ServerReadyEvent): void;
	said(said: ServerOutputEvent): void;
	connection(change: ServerConnectionEvent): void;
	stopped(stop: ServerExitEvent): void;
	changed(change: ServeChangeEvent): void;
	shutdown(target: ServeTarget | undefined): void;
	error(error: Error): void;
	abort(error: Error): void;
	end(message: string): void;
}

const serverFor = (target: ServeTarget, plan: ServePlan): SyncServer =>
	target.servedBy?.server ?? plan.executable.server;

const RETIRED_BECAUSE = {
	removed: "its config is gone",
	moved: "its address changed",
} as const;

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
		const { selection } = plan;
		this.watchLog.begin(selection.configs, selection.home);
		if (isServed(plan.target)) this.running(plan.target);
	}

	update(update: WatchUpdate): void {
		this.watchLog.update(update);
	}

	serving({ target, info }: ServerReadyEvent): void {
		this.logService.success(
			`Serving ${target.config.label} with ${serverOf(info)} at ${target.address}.`
		);
	}

	said(said: ServerOutputEvent): void {
		reportServerOutput(
			this.logService,
			this.plan.executable.server.name,
			said.message,
			this.cwd
		);
	}

	connection({ target, opened, clients }: ServerConnectionEvent): void {
		const { label } = target.config;
		this.logService.info(
			opened
				? `Studio connected to ${label}${clients > 1 ? ` (${clients} connected)` : ""}.`
				: `Studio disconnected from ${label}${clients > 0 ? `, ${clients} still connected` : ""}.`
		);
	}

	stopped({ target, interrupted, failure }: ServerExitEvent): void {
		if (failure) this.logService.diagnostic(failure);
		else if (!interrupted)
			this.logService.info(
				`${serverFor(target, this.plan).name} stopped serving ${target.config.label}.`
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
		this.watchLog.error(error);
	}

	abort(): void {
		this.logService.closeFrame("serve failed.");
	}

	end(message: string): void {
		this.watchLog.end(message);
	}

	private running(target: ServedTarget): void {
		const { servedBy: info } = target;
		const served = `${serverOf(info)} serves a project named ${info.project} at ${target.address}${info.session ? ` (session ${info.session})` : ""}.`;
		this.logService.info(
			`${target.config.label} is already served by another rogen serve: ${served}`
		);
	}
}

export class ServeJsonLog implements ServeReporter {
	private readonly told = new WeakSet<Error>();
	private readonly watchLog: WatchJsonLog;

	constructor(
		private readonly logService: LogService,
		private readonly plan: ServePlan
	) {
		this.watchLog = new WatchJsonLog(logService);
	}

	begin(): void {
		if (isServed(this.plan.target)) this.running(this.plan.target);
	}

	update(update: WatchUpdate): void {
		this.watchLog.update(update);
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
				...this.serverFields(target),
				severity: message.severity,
				message: message.text,
			},
		});
	}

	connection({ target, opened, clients }: ServerConnectionEvent): void {
		this.line({
			[opened ? "connected" : "disconnected"]: {
				...this.serverFields(target),
				project: target.project,
				port: target.address.port,
				clients,
			},
		});
	}

	stopped({ target, exit, failure }: ServerExitEvent): void {
		this.line({
			stopped: this.stoppedJson(target, "exited", {
				code: exit.code,
				signal: exit.signal,
			}),
		});
		if (failure) this.line(diagnosticsJson([failure]));
	}

	changed(change: ServeChangeEvent): void {
		const { target } = change;
		switch (change.kind) {
			case "servedElsewhere":
				this.running(change.target);
				return;
			case "refused":
				this.line({
					refused: {
						...this.serverFields(target),
						diagnostics: [diagnosticToJson(change.diagnostic)],
					},
				});
				return;
			case "retired":
				this.line({ stopped: this.stoppedJson(target, change.reason) });
		}
	}

	shutdown(target: ServeTarget | undefined): void {
		if (target)
			this.line({ stopped: this.stoppedJson(target, "shutdown") });
	}

	error(error: Error): void {
		this.told.add(error);
		this.watchLog.error(error);
	}

	abort(error: Error): void {
		if (!this.told.has(error)) this.line(failureToJson(error));
	}

	end(): void {}

	private running(target: ServedTarget): void {
		this.line({
			serving: this.servingJson(target, target.servedBy, true),
		});
	}

	private stoppedJson(
		target: ServeTarget,
		reason: string,
		extra: Record<string, unknown> = {}
	): Record<string, unknown> {
		return {
			...this.serverFields(target),
			reason,
			...extra,
		};
	}

	private serverFields(target: ServeTarget): {
		config: string;
		server: string;
	} {
		return {
			config: target.config.label,
			server: serverFor(target, this.plan).id,
		};
	}

	private servingJson(
		target: ServeTarget,
		info: ServerInfo,
		alreadyRunning: boolean
	): Record<string, unknown> {
		return {
			config: target.config.label,
			server: info.server.id,
			version: info.version,
			project: info.project,
			host: target.address.host,
			port: target.address.port,
			...(info.session && { session: info.session }),
			reportsConnections:
				!alreadyRunning && info.server.reportsConnections(info.version),
			...(alreadyRunning && { alreadyRunning }),
		};
	}

	private line(value: unknown): void {
		this.watchLog.line(value);
	}
}
