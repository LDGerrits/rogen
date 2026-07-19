import { ConsoleLogger, LogLevel } from "../src/platform/log/logger.js";

export const logger = new ConsoleLogger();
logger.setLevel(LogLevel.Off);
