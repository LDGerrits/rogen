import path from "path";
import { DeferredPromise } from "../../base/async.js";
import { DisposableStore } from "../../base/disposable.js";
import { ErrorUtils } from "../../base/errors.js";
import { err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import { ConfigService } from "../../domain/config/config-service.js";
import { WatchService } from "../../domain/watch/watch-service.js";
import {
	ConfigNotice,
	RebuildReport,
	WatchCause,
	WatchUpdate,
} from "../../domain/watch/watch-session.js";
import {
	CommandRegistry,
	Extensions,
} from "../../platform/commands/commands.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { LifecycleService } from "../../platform/lifecycle/lifecycle-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { Registry } from "../../platform/registry/registry.js";
import { beginBuild } from "../build/begin-build.js";
import {
	logBuildDetails,
	logWritten,
	outFileLabel,
} from "../build/log-build.js";
import { ConfigOptions } from "../config-options.js";
import {
	clockTime,
	describeChange,
	describeFileChanges,
} from "./describe-change.js";

function titleOf(cause: WatchCause): string {
	switch (cause.kind) {
		case "initial":
			return "initial build";
		case "burst":
			return "many changes · full rebuild";
		case "change":
			return describeChange({
				sourceFiles: cause.sourceFiles,
				configFiles: cause.configFiles.map((file) =>
					path.basename(file)
				),
				reloaded: cause.reloaded,
			});
	}
}

Registry.as<CommandRegistry>(Extensions.Commands).registerCommand({
	id: "watch",
	metadata: {
		requiresConfig: true,
		description:
			"Builds, then rebuilds whenever sources or configs change.",
		args: [
			{
				name: "name",
				description: "A config to watch.",
				isOptional: true,
				isVariadic: true,
				namesConfig: true,
			},
		],
		options: ConfigOptions,
	},
	handler: async (accessor) => {
		const logService = accessor.get(LogService);
		const lifecycleService = accessor.get(LifecycleService);
		const configService = accessor.get(ConfigService);
		const buildService = accessor.get(BuildService);
		const watchService = accessor.get(WatchService);
		const cwd = accessor.get(EnvironmentService).cwd;

		const began = await beginBuild({
			configService,
			buildService,
			logService,
			command: "watch",
		});
		if (began.isErr()) return began;

		const printNotice = ({ file, errors, warnings }: ConfigNotice) => {
			for (const diagnostic of errors) logService.diagnostic(diagnostic);
			if (errors.length > 0) {
				logService.error(
					`Still building from the last valid ${path.basename(file)}.`
				);
			}
			for (const diagnostic of warnings)
				logService.diagnostic(diagnostic);
		};

		const printReport = ({
			entry,
			config,
			outcome,
			diagnostics,
			summary,
		}: RebuildReport) => {
			if (outcome === "failed" || !summary) {
				const outFile = outFileLabel(config, cwd);
				logService.error(
					diagnostics.length > 0
						? `${outFile} · not written`
						: `${outFile} · not written · same errors as before`
				);
				logBuildDetails(logService, cwd, entry);
			} else {
				logWritten(
					logService,
					cwd,
					{ entry, config },
					outcome === "wrote",
					summary
				);
			}
			for (const diagnostic of diagnostics)
				logService.diagnostic(diagnostic);
		};

		const printUpdate = ({
			at,
			cause,
			changes,
			notices,
			reports,
		}: WatchUpdate) => {
			logService.step(`${clockTime(at)} · ${titleOf(cause)}`);
			for (const line of describeFileChanges(changes, cwd))
				logService.debug(line);
			notices.forEach(printNotice);
			reports.forEach(printReport);
		};

		const store = new DisposableStore();
		const shutdown = new DeferredPromise<void>();
		const session = store.add(watchService.watch());
		try {
			store.add(
				lifecycleService.onWillShutdown(() => shutdown.complete())
			);
			store.add(session.onDidUpdate(printUpdate));
			store.add(
				session.onDidError((error) => logService.error(error.message))
			);

			await session.start();
			await shutdown.p;
			await session.stop();
			logService.outro("Stopped watching.");
			return ok(undefined);
		} catch (error) {
			return err(ErrorUtils.fromUnknown(error));
		} finally {
			await session.stop();
			store[Symbol.dispose]();
		}
	},
});
