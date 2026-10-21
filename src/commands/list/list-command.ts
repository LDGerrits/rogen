import { Result, err, ok } from "../../base/result.js";
import {
	ConfigArguments,
	ConfigService,
} from "../../domain/config/config-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import { CommandLine, JsonOption } from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { configsOf } from "../../domain/config/resolved-config.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { ServeService } from "../../domain/serve/serve-service.js";
import { BuildService } from "../../domain/build/build-service.js";
import {
	Diagnostic,
	uniqueDiagnostics,
} from "../../platform/diagnostics/diagnostic.js";
import { ListLog, ServingByConfig, listDocumentShape } from "./list-log.js";

const ListOptions = [JsonOption] as const;

registerCommand(
	class ListCommand extends AbstractCommand<typeof ListOptions> {
		constructor() {
			super({
				id: "list",
				metadata: {
					summary:
						"Lists the configs here, their files and their ports",
					description:
						"Lists every config file of this folder, or the one you name, with its source paths, routes, sync path and project file, and which are served. A config other than default.rogen.json also lists the keys that differ from it; with --json, each fully resolved.",
					args: ConfigArguments,
					options: ListOptions,
					output: { document: listDocumentShape },
					effects: [],
					examples: ["rogen list", "rogen list --json"],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof ListOptions>
		): Promise<Result<void, Error>> {
			const logService = accessor.get(LogService);
			const configService = accessor.get(ConfigService);
			const cwd = accessor.get(EnvironmentService).cwd;

			const selection =
				line.positionals.length === 0
					? await configService.selectFolder()
					: await configService.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);
			const { entries, home } = selection.value;
			const report = new ListLog(logService, cwd);
			const broken = ListLog.failure(entries);
			const serveService = accessor.get(ServeService);
			const projectFiles = entries.flatMap((entry) =>
				entry.status === "valid"
					? configsOf(entry, entry.scope).map(
							({ projectFile }) => projectFile
						)
					: []
			);
			const served = await serveService.servedBy(projectFiles);
			const serving: ServingByConfig = new Map(
				projectFiles.map((file) => [file, served.get(file)])
			);
			const buildService = accessor.get(BuildService);
			const stale = await buildService.staleProjectFiles(selection.value);
			const problems = new Map<string, Diagnostic[]>();
			for (const entry of entries)
				if (entry.status === "valid") {
					const projects = configsOf(entry, entry.scope);
					const files = new Set(
						projects.map(({ projectFile }) => projectFile)
					);
					problems.set(
						entry.file,
						uniqueDiagnostics([
							...(
								await Promise.all(
									projects.map((project) =>
										buildService.missingSourcePaths(project)
									)
								)
							).flat(),
							...stale.filter(({ resource }) =>
								files.has(resource)
							),
						])
					);
				}

			if (line.options.json)
				return this.printJson(
					logService,
					report.json(entries, serving, problems),
					broken
				);

			report.print(entries, home, serving, problems);
			return broken ? err(broken) : ok(undefined);
		}
	}
);
