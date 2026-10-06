import { CommandLine } from "./args.js";
import { EnvironmentService } from "./environment-service.js";

export class NativeEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	readonly verbose: boolean;
	readonly quiet: boolean;

	constructor(
		options: CommandLine["options"],
		readonly cwd: string
	) {
		this.verbose = options.verbose === true;
		this.quiet = options.quiet === true;
	}
}
