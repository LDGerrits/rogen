import { BrowserService } from "../browser-service.js";

export class MockBrowserService implements BrowserService {
	declare readonly _serviceBrand: undefined;

	readonly opened: string[] = [];

	constructor(private readonly succeeds = true) {}

	async open(url: string): Promise<boolean> {
		this.opened.push(url);
		return this.succeeds;
	}
}
