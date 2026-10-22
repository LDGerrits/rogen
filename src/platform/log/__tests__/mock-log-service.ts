import { AbstractLogService, LogKind } from "../abstract-log-service.js";

export interface LoggedEntry {
	readonly kind: LogKind;
	readonly text: string;
}

export class MockLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	readonly entries: LoggedEntry[] = [];

	drawsFrame = false;

	get reserved(): boolean {
		return this.stdoutReserved;
	}

	get lines(): string[] {
		return this.entries.map(({ kind, text }) => `${kind}: ${text}`);
	}

	texts(kind: LogKind): string[] {
		return this.entries
			.filter((entry) => entry.kind === kind)
			.map(({ text }) => text);
	}

	json<T = ReturnType<typeof JSON.parse>>(): T {
		return JSON.parse(this.texts("print").join("\n")) as T;
	}

	clear(): void {
		this.entries.length = 0;
	}

	protected write(kind: LogKind, text: string): void {
		this.entries.push({ kind, text });
	}
}
