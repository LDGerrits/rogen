import { ScannedRoot } from "../root-scanner.js";
import { RootClaims } from "../dir-claims.js";
import { NameReadings } from "../name-readings.js";
import { abs, configOf } from "./fixtures.js";

describe("RootClaims", () => {
	const readings = () =>
		new NameReadings(configOf().keys, new Set(), [], new Map());

	it("should refuse a root it was not given to scan", () => {
		expect(() =>
			new RootClaims([], readings()).of({
				sourcePath: abs("src"),
			} as ScannedRoot)
		).toThrow(`${abs("src")} was not scanned.`);
	});

	it("should refuse the reading of a file it never scanned", () => {
		expect(() => readings().entryReading(abs("src/A.luau"))).toThrow(
			`${abs("src/A.luau")} was not scanned.`
		);
	});
});
