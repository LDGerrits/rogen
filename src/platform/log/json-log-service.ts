import { NullLogService } from "./null-log-service.js";

/** For `--json`: the document on stdout and nothing else, so no line beside it, `--verbose`'s included, can break what a program reads. */
export class JsonLogService extends NullLogService {
	override print(text: string): void {
		console.info(text);
	}
}
