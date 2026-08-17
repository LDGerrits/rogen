// src/commands/build/build-command.ts
import { Command } from "../command.js";
import { CliArgs } from "../args.js";
import { Result, ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { ResolvedConfig } from "../../domain/config/config-schema.js";

export class BuildCommand implements Command {
	constructor(
		private readonly logService: LogService,
		private readonly config: ResolvedConfig
	) {}

	async execute(_args: CliArgs): Promise<Result<void, Error>> {
		this.logService.info("Starting build process...");

		this.logService.debug(
			`Loaded config for build: ${JSON.stringify(this.config)}`
		);

		// TODO: Implement build logic

		return ok(undefined);
	}
}
