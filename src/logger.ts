export enum LogLevel {
	Off = 0,
	Error = 1,
	Warn = 2,
	Success = 3,
	Info = 4,
	Debug = 5,
	Trace = 6,
}

export interface Logger {
	setLevel(level: LogLevel): void;
	getLevel(): LogLevel;

	error(message: string | Error, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	success(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;
}

export abstract class AbstractLogger implements Logger {
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
	abstract success(message: string, ...args: unknown[]): void;
	abstract info(message: string, ...args: unknown[]): void;
	abstract debug(message: string, ...args: unknown[]): void;
	abstract trace(message: string, ...args: unknown[]): void;
}

function getTimeStamp(wrapInBrackets = true): string {
	const now = new Date();
	const h = String(now.getHours()).padStart(2, "0");
	const m = String(now.getMinutes()).padStart(2, "0");
	const s = String(now.getSeconds()).padStart(2, "0");
	const timeStamp = `${h}:${m}:${s}`;
	return wrapInBrackets ? `[${timeStamp}]` : timeStamp;
}

export class ConsoleLogger extends AbstractLogger {
	private readonly colors = {
		reset: "\x1b[0m",
		red: "\x1b[31m",
		green: "\x1b[32m",
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

	success(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Info)) {
			console.info(
				`${getTimeStamp()} ${this.colors.green}success:${this.colors.reset} ${this.format(message, args)}`
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

export class NullLogger implements Logger {
	setLevel(_level: LogLevel): void {}
	getLevel(): LogLevel {
		return LogLevel.Off;
	}
	error(_message: string | Error, ..._args: unknown[]): void {}
	warn(_message: string, ..._args: unknown[]): void {}
	success(_message: string, ..._args: unknown[]): void {}
	info(_message: string, ..._args: unknown[]): void {}
	debug(_message: string, ..._args: unknown[]): void {}
	trace(_message: string, ..._args: unknown[]): void {}
}
