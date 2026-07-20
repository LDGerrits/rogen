import { AbstractLogService, LogLevel } from "./log-service.js";

export class ConsoleLogService extends AbstractLogService {
	private readonly colors = {
		reset: "\x1b[0m",
		red: "\x1b[31m",
		yellow: "\x1b[33m",
		gray: "\x1b[90m",
		cyan: "\x1b[36m",
	};

	error(message: string | Error, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Error)) {
			console.error(
				`${this.colors.red}error:${this.colors.reset} ${this.format(message, args)}`
			);
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Warn)) {
			console.warn(
				`${this.colors.yellow}warning:${this.colors.reset} ${this.format(message, args)}`
			);
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Info)) {
			console.info(this.format(message, args));
		}
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Debug)) {
			console.debug(
				`${this.colors.gray}[debug] ${this.format(message, args)}${this.colors.reset}`
			);
		}
	}

	trace(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Trace)) {
			console.debug(
				`${this.colors.cyan}[trace] ${this.format(message, args)}${this.colors.reset}`
			);
		}
	}
}
