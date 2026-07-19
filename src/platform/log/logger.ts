export enum LogLevel {
	Off = 0,
	Error = 1,
	Warn = 2,
	Info = 3,
	Debug = 4,
	Trace = 5,
}

export interface ILogger {
	setLevel(level: LogLevel): void;
	getLevel(): LogLevel;

	error(message: string | Error, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;
}

abstract class AbstractLogger implements ILogger {
	protected level: LogLevel = LogLevel.Info;

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	getLevel(): LogLevel {
		return this.level;
	}

	protected canLog(level: LogLevel): boolean {
		return this.level !== LogLevel.Off && this.level >= level;
	}

	protected format(message: string | Error, args: unknown[]): string {
		let result =
			message instanceof Error
				? message.stack || message.message
				: message;

		for (const arg of args) {
			if (arg instanceof Error) {
				result += " " + (arg.stack || arg.message);
			} else if (typeof arg === "object") {
				try {
					result += " " + JSON.stringify(arg);
				} catch {
					result += " [Unserializable Object]";
				}
			} else {
				result += " " + arg;
			}
		}
		return result;
	}

	abstract error(message: string | Error, ...args: unknown[]): void;
	abstract warn(message: string, ...args: unknown[]): void;
	abstract info(message: string, ...args: unknown[]): void;
	abstract debug(message: string, ...args: unknown[]): void;
	abstract trace(message: string, ...args: unknown[]): void;
}

export class ConsoleLogger extends AbstractLogger {
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

export const logger = new ConsoleLogger();
