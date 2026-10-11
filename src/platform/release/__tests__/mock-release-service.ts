import { ReleaseService } from "../release-service.js";

export class MockReleaseService implements ReleaseService {
	declare readonly _serviceBrand: undefined;

	readonly announced: string[] = [];

	constructor(public versions: readonly string[] = []) {}

	async published(): Promise<readonly string[]> {
		return this.versions;
	}

	async announce(version: string): Promise<boolean> {
		if (this.announced.includes(version)) return false;
		this.announced.push(version);
		return true;
	}
}
