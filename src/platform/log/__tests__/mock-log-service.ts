import { AbstractLogService, LogKind } from "../abstract-log-service.js";
import { LogLevel, OutputStream } from "../log-service.js";

export interface LoggedEntry {
	readonly kind: LogKind;
	readonly stream: OutputStream;
	readonly text: string;
}

export class MockLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	readonly entries: LoggedEntry[] = [];

	drawsFrame = false;

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	sendOwnLinesTo(stream: OutputStream): void {
		this.ownLines = stream;
	}

	get lines(): string[] {
		return this.entries.map(({ kind, text }) => `${kind}: ${text}`);
	}

	on(stream: OutputStream): string[] {
		return this.entries
			.filter((entry) => entry.stream === stream)
			.map(({ kind, text }) => `${kind}: ${text}`);
	}

	texts(kind: LogKind): string[] {
		return this.entries
			.filter((entry) => entry.kind === kind)
			.map(({ text }) => text);
	}

	json<T = ReturnType<typeof JSON.parse>>(): T {
		return JSON.parse(this.texts("result").join("\n")) as T;
	}

	clear(): void {
		this.entries.length = 0;
	}

	protected write(kind: LogKind, stream: OutputStream, text: string): void {
		this.entries.push({ kind, stream, text });
	}
}
