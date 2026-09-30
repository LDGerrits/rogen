import { ParsedArgs } from "./args.js";
import { EnvironmentService } from "./environment-service.js";

export class NativeEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	get verbose(): boolean {
		return !!this.args.verbose;
	}
	get quiet(): boolean {
		return !!this.args.quiet;
	}

	constructor(
		public readonly args: ParsedArgs,
		public readonly cwd: string
	) {}
}
