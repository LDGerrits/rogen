import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { BuildService } from "../../domain/build/build-service.js";
import {
	ProjectArgument,
	singleProjectError,
	ConfigService,
} from "../../domain/config/config-service.js";
import { RojoCommandService } from "../../domain/runner/rojo-command-service.js";
import {
	AbstractCommand,
	registerCommand,
} from "../../platform/commands/commands.js";
import {
	CommandLine,
	JsonOption,
	OptionDescriptor,
} from "../../platform/environment/args.js";
import { EnvironmentService } from "../../platform/environment/environment-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import { rojoEntry } from "../build/build-document.js";
import { reportRojo, reportRojoBesideFailure } from "../build/report-rojo.js";
import { uploadDocument, uploadDocumentShape } from "./upload-document.js";

const AssetIdOption = {
	name: "asset_id",
	type: "string",
	placeholder: "asset_id",
	description:
		"The place or model to upload to. Rojo needs it, and spells it with an underscore.",
} as const satisfies OptionDescriptor;

const ApiKeyOption = {
	name: "api_key",
	type: "string",
	placeholder: "api_key",
	description:
		"An API key from create.roblox.com/credentials: Rojo uploads with Open Cloud, to a place only, and needs --universe_id.",
} as const satisfies OptionDescriptor;

const UniverseIdOption = {
	name: "universe_id",
	type: "string",
	placeholder: "universe_id",
	description: "The universe of the place, for an upload with --api_key.",
} as const satisfies OptionDescriptor;

const CookieOption = {
	name: "cookie",
	type: "string",
	placeholder: "cookie",
	description:
		"The authentication cookie to upload with. Without it Rojo looks for one on this machine.",
} as const satisfies OptionDescriptor;

const UploadOptions = [
	JsonOption,
	AssetIdOption,
	ApiKeyOption,
	UniverseIdOption,
	CookieOption,
] as const;

registerCommand(
	class UploadCommand extends AbstractCommand<typeof UploadOptions> {
		constructor() {
			super({
				id: "upload",
				metadata: {
					summary:
						"Writes the project file, then uploads it with Rojo",
					description:
						"Writes the project file, then has Rojo build the project and upload it to Roblox, as 'rojo upload' does.",
					args: ProjectArgument,
					picker: [
						{
							message:
								"Asset ID of the place or model to upload to",
							validate: (value) =>
								/^\d+$/.test(value)
									? undefined
									: "An asset ID is a number.",
							into: { option: "asset_id" },
						},
					],
					options: UploadOptions,
					output: { document: uploadDocumentShape },
					effects: ["writesFiles", "runsProcesses"],
					exitCodes: {
						"1": "the project has errors, or Rojo failed",
						"2": "the command line is wrong, or Rojo refused it",
					},
					examples: [
						"rogen upload --asset_id 123456",
						"rogen upload places/lobby --asset_id 123456 --api_key $KEY --universe_id 7890",
						"rogen upload --asset_id 123456 --json",
					],
				},
			});
		}

		async run(
			accessor: ServicesAccessor,
			line: CommandLine<typeof UploadOptions>
		): Promise<Result<void, Error>> {
			const tooMany = singleProjectError("upload", line.positionals);
			if (tooMany) return err(tooMany);
			const { asset_id, api_key, universe_id, cookie } = line.options;
			if (asset_id === undefined)
				return err(
					new UsageError(
						"--asset_id names the place or model to upload to, and Rojo needs it."
					)
				);
			const flags = [
				"--asset_id",
				asset_id,
				...(api_key === undefined ? [] : ["--api_key", api_key]),
				...(universe_id === undefined
					? []
					: ["--universe_id", universe_id]),
				...(cookie === undefined ? [] : ["--cookie", cookie]),
			];
			const rojoService = accessor.get(RojoCommandService);
			const logService = accessor.get(LogService);
			if (!line.options.json) logService.reserveStdout();
			const cwd = accessor.get(EnvironmentService).cwd;

			const selection = await accessor
				.get(ConfigService)
				.select(line.positionals);
			if (selection.isErr()) return selection;
			for (const note of selection.value.notes) logService.warn(note);

			const project = selection.value.requireValid().isErr()
				? undefined
				: rojoService.choose(selection.value);

			const build = await accessor
				.get(BuildService)
				.build(selection.value);
			const failure = build.failure();
			const uploaded =
				failure || project === undefined
					? undefined
					: await rojoService.run(selection.value, {
							command: "upload",
							flags,
							cwd,
							project,
						});
			const rojoFailure =
				uploaded === undefined
					? undefined
					: uploaded.isErr()
						? uploaded.error
						: uploaded.value.failure;

			if (line.options.json)
				return this.printJson(
					logService,
					uploadDocument(
						build.builds,
						rojoEntry({ command: "upload", cwd }, uploaded)
					),
					failure ?? rojoFailure
				);
			new BuildLog(logService, cwd).report(
				build,
				selection.value.home,
				"upload"
			);
			if (uploaded?.isOk())
				(rojoFailure ? reportRojoBesideFailure : reportRojo)(
					logService,
					uploaded.value.messages,
					cwd
				);
			if (rojoFailure) return err(rojoFailure);
			return failure ? this.reported(failure) : ok(undefined);
		}
	}
);
