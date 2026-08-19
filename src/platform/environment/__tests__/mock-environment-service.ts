import { ParsedArgs } from "../args.js";
import { EnvironmentService } from "../environment-service.js";

export class MockEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	constructor(
		public readonly args: ParsedArgs = { _: [] },
		public readonly cwd: string = "/mock/cwd",
		public readonly verbose: boolean = false,
		public readonly trace: boolean = false,
		public readonly quiet: boolean = false
	) {}
}
