import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import {
	ProjectArgument,
	singleProjectError,
} from "../../domain/config/config-service.js";
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
import { InstantiationService } from "../../platform/instantiation/instantiation-service.js";
import { ServicesAccessor } from "../../platform/instantiation/instantiation.js";
import { LogService } from "../../platform/log/log-service.js";
import { rojoEntry } from "../write/rojo-entry.js";
import { RojoRun } from "../write/rojo-run.js";
import { uploadDocument, uploadDocumentShape } from "./upload-document.js";
import { UploadStep } from "./upload-step.js";

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
		"An API key from create.roblox.com/credentials. Rojo uploads with Open Cloud, to a place only, and needs --universe_id.",
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
		"The authentication cookie to upload with. Without it, on Windows, Rojo uses the cookie Roblox Studio stored; elsewhere it needs this option.",
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
					options: UploadOptions,
					output: { document: uploadDocumentShape },
					effects: ["writesFiles", "runsProcesses"],
					exitCodes: {
						"1": "the project has errors, or Rojo failed",
						"2": "the command line is wrong, or Rojo refused it",
						"128+N":
							"stopped by a signal: 130 for Ctrl+C, 143 for SIGTERM, 129 for SIGHUP",
					},
					examples: [
						"rogen upload --asset_id 123456",
						"rogen upload lobby --asset_id 123456 --api_key $KEY --universe_id 7890",
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
				`--asset_id=${asset_id}`,
				...(api_key === undefined ? [] : [`--api_key=${api_key}`]),
				...(universe_id === undefined
					? []
					: [`--universe_id=${universe_id}`]),
				...(cookie === undefined ? [] : [`--cookie=${cookie}`]),
			];
			const logService = accessor.get(LogService);
			const cwd = accessor.get(EnvironmentService).cwd;
			const instantiationService = accessor.get(InstantiationService);
			const step = instantiationService.createInstance(
				UploadStep,
				flags,
				cwd,
				asset_id
			);
			const rojoRun = instantiationService.createInstance(
				RojoRun,
				line.positionals,
				step,
				cwd
			);
			const done = await rojoRun.run();
			if (done.isErr()) return done;
			const { written, failure, ran, rojoFailure } = done.value;
			if (line.options.json)
				return this.printJson(
					logService,
					uploadDocument(
						written.outcomes,
						cwd,
						rojoEntry(step.target, ran)
					),
					failure ?? rojoFailure
				);
			rojoRun.report(done.value);
			if (rojoFailure) return err(rojoFailure);
			return failure ? this.reported(failure) : ok(undefined);
		}
	}
);
