import { AbstractLogService, LogKind } from "../log-service.js";

export interface LoggedEntry {
	readonly kind: LogKind;
	readonly text: string;
}

export class MockLogService extends AbstractLogService {
	declare readonly _serviceBrand: undefined;

	readonly entries: LoggedEntry[] = [];

	get lines(): string[] {
		return this.entries.map(({ kind, text }) => `${kind}: ${text}`);
	}

	protected write(kind: LogKind, text: string): void {
		this.entries.push({ kind, text });
	}
}
