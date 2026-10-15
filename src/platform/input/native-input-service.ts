import { InputService } from "./input-service.js";

export class NativeInputService implements InputService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly input: NodeJS.ReadableStream & {
			readonly isTTY?: boolean;
		} = process.stdin
	) {}

	get isTerminal(): boolean {
		return Boolean(this.input.isTTY);
	}

	async readAll(): Promise<string> {
		this.input.setEncoding("utf8");
		let text = "";
		for await (const chunk of this.input) text += chunk as string;
		return text;
	}
}
