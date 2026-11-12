import { instantiationOf } from "../../instantiation/__tests__/instantiation-of.js";
import { LogService } from "../../log/log-service.js";
import { DiskWatcher } from "../disk-watcher.js";

export const diskWatcherOf = (log: LogService): DiskWatcher =>
	instantiationOf([LogService, log]).createInstance(DiskWatcher);
