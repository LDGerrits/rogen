export enum LogLevel {
	Off = 0,
	Error = 1,
	Warn = 2,
	Info = 3,
	Debug = 4,
	Trace = 5,
}

export interface LogService {
	setLevel(level: LogLevel): void;
	getLevel(): LogLevel;

	error(message: string | Error, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
	trace(message: string, ...args: unknown[]): void;
}

export abstract class AbstractLogService implements LogService {
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
