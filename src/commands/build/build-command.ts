import { Command } from "../command.js";
import { Result, ok } from "../../base/result.js";
import { LogService } from "../../platform/log/log-service.js";
import { ParsedArgs } from "../../platform/environment/args.js";
import { ConfigService } from "../../domain/config/config-service.js";

export class BuildCommand implements Command {
	constructor(
		private readonly logService: LogService,
		private readonly configService: ConfigService
	) {}

	async execute(_args: ParsedArgs): Promise<Result<void, Error>> {
		const config = this.configService.getValue();
		this.logService.info(`Building with ${config.casing} casing...`);

		// TODO: Implement build logic

		return ok(undefined);
	}
}
