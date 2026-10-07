import { EnvironmentService } from "../environment-service.js";

export class MockEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	readonly isPlain: boolean;

	constructor(
		public readonly cwd: string = "/mock/cwd",
		public readonly verbose: boolean = false,
		public readonly quiet: boolean = false,
		public readonly isInteractive: boolean = false
	) {
		this.isPlain = !isInteractive;
	}
}
