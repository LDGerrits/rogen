import { instantiationOf } from "../../instantiation/__tests__/instantiation-of.js";
import { LogService } from "../../log/log-service.js";
import { CommandFailure } from "../command-failure.js";

export const failureOf = (log: LogService, json: boolean): CommandFailure =>
	instantiationOf([LogService, log]).createInstance(CommandFailure, json);
