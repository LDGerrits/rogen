import { Result } from "../base/result.js";

export interface Command {
	execute(): Promise<Result<void, Error>> | Result<void, Error>;
}
