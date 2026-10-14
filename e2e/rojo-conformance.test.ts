import fs from "fs";
import path from "path";
import { pinnedRojoVersion } from "../scripts/vendor-rojo-build-tests.js";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { bundleCli } from "./harness.js";
import { PROJECTS_DIR, roundTrip } from "./rojo-conformance.js";

/** The projects Rogen can't write back yet, and what each needs. */
const NOT_YET: Readonly<Record<string, string>> = {
	sync_rule_alone: "syncRules",
	sync_rule_complex: "syncRules",
	sync_rule_nested_projects: "syncRules",
};

const projects = fs
	.readdirSync(PROJECTS_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

describe("Rojo's build tests", () => {
	it("should be the ones of the Rojo version the project pins", () => {
		expect(
			fs.readFileSync(path.join(PROJECTS_DIR, "VERSION"), "utf8").trim()
		).toBe(pinnedRojoVersion(fs.readFileSync("rokit.toml", "utf8")));
	});

	it("should not mark a project that does not exist", () => {
		expect(projects).toEqual(expect.arrayContaining(Object.keys(NOT_YET)));
	});
});

describeWithRojo("end to end Rojo conformance", () => {
	let bundle: ReturnType<typeof bundleCli>;

	beforeAll(() => {
		bundle = bundleCli();
	});

	afterAll(() => {
		bundle.dispose();
	});

	it.each(projects.filter((name) => !NOT_YET[name]))(
		"should write %s back and build the same place",
		(name) => {
			const result = roundTrip(bundle.cli, name);

			expect(result.rogen).toMatchObject({ status: 0, stderr: "" });
			expect(result.written).toEqual(result.original);
			expect(result.placeOfWritten).toBeDefined();
			expect(result.placeOfWritten).toBe(result.placeOfOriginal);
		},
		30_000
	);

	it.failing.each(
		Object.entries(NOT_YET).map(([name, needs]) => [name, needs])
	)(
		"should write %s back and build the same place once %s is supported",
		(name) => {
			const result = roundTrip(bundle.cli, name);

			expect(result.rogen).toMatchObject({ status: 0, stderr: "" });
			expect(result.written).toEqual(result.original);
			expect(result.placeOfWritten).toBeDefined();
			expect(result.placeOfWritten).toBe(result.placeOfOriginal);
		},
		30_000
	);
});
