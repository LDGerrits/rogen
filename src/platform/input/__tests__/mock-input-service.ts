import { InputService } from "../input-service.js";

export class MockInputService implements InputService {
	declare readonly _serviceBrand: undefined;

	constructor(private readonly text: string = "") {}

	async readAll(): Promise<string> {
		return this.text;
	}
}
