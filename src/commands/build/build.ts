import { Command } from "../command.js";
import { CliArgs } from "../args.js";
import { Result, ok, err } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { ConfigLoader } from "../../domain/config/loader.js";

export class BuildCommand implements Command {
	constructor(
		private readonly logService: LogService,
		private readonly configLoader: ConfigLoader
	) {}

	async execute(_args: CliArgs): Promise<Result<void, Error>> {
		this.logService.info("Starting build process...");

		const configResult = await this.configLoader.load();

		if (configResult.isErr()) {
			return err(configResult.error);
		}

		const config = configResult.unwrap();

		this.logService.debug(
			`Loaded config for build: ${JSON.stringify(config)}`
		);

		return ok(undefined);
	}
}
