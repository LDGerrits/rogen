import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import {
	CASES_DIR,
	NETWORK_TIMEOUT_MS,
	bundleCli,
	discoverCases,
	needsNetwork,
	runCase,
} from "./harness.js";

const UPDATE = process.env.UPDATE_E2E === "1";
const online = process.env.ROGEN_E2E_NETWORK === "1";
const cases = discoverCases();
const downloading = cases.filter(needsNetwork);
const local = cases.filter((name) => !downloading.includes(name));

describeWithRojo("end to end", () => {
	let bundle: ReturnType<typeof bundleCli>;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	const transcriptOf = async (name: string) => {
		const transcript = await runCase(bundle.cli, name);
		const expectedFile = path.join(CASES_DIR, name, "expected.txt");

		if (UPDATE) fs.writeFileSync(expectedFile, transcript);
		if (!fs.existsSync(expectedFile)) {
			throw new Error(
				`Missing ${expectedFile}; run "npm run test:e2e:update".`
			);
		}
		return { transcript, expected: fs.readFileSync(expectedFile, "utf8") };
	};

	it("should discover cases", () => {
		expect(cases.length).toBeGreaterThan(0);
	});

	it.concurrent.each(local)("%s", async (name) => {
		const { transcript, expected } = await transcriptOf(name);

		expect(transcript).toBe(expected);
	});

	if (online)
		it.concurrent.each(downloading)(
			"%s",
			async (name) => {
				const { transcript, expected } = await transcriptOf(name);

				expect(transcript).toBe(expected);
			},
			NETWORK_TIMEOUT_MS * 2
		);
	else
		for (const name of downloading)
			it.todo(`${name} (needs ROGEN_E2E_NETWORK=1)`);
});
