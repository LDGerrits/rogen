import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { CASES_DIR, bundleCli, discoverCases, runCase } from "./harness.js";

const UPDATE = process.env.UPDATE_E2E === "1";
const cases = discoverCases();

describeWithRojo("end to end", () => {
	let bundle: ReturnType<typeof bundleCli>;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	it("should discover cases", () => {
		expect(cases.length).toBeGreaterThan(0);
	});

	it.concurrent.each(cases)("%s", async (name) => {
		const transcript = await runCase(bundle.cli, name);
		const expectedFile = path.join(CASES_DIR, name, "expected.txt");

		if (UPDATE) {
			fs.writeFileSync(expectedFile, transcript);
			return;
		}
		if (!fs.existsSync(expectedFile)) {
			throw new Error(
				`Missing ${expectedFile}; run "UPDATE_E2E=1 npm test".`
			);
		}
		expect(transcript).toBe(fs.readFileSync(expectedFile, "utf8"));
	});
});
