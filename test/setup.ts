import { ConsoleLogService } from "../src/platform/log/console-log-service.js";
import { LogLevel } from "../src/platform/log/log-service.js";

export const logService = new ConsoleLogService();
logService.setLevel(LogLevel.Off);
