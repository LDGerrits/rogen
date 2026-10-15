import fs from "fs";
import path from "path";
import { pinnedRojoVersion } from "../scripts/vendor-rojo-build-tests.js";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { bundleCli } from "./harness.js";
import {
	GLOB_PROJECTS_DIR,
	PROJECTS_DIR,
	roundTrip,
} from "./rojo-conformance.js";

const projects = fs
	.readdirSync(PROJECTS_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

const globProjects = fs
	.readdirSync(GLOB_PROJECTS_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

describe("Rojo's build tests", () => {
	it("should be the ones of the Rojo version the project pins", () => {
		expect(
			fs.readFileSync(path.join(PROJECTS_DIR, "VERSION"), "utf8").trim()
		).toBe(pinnedRojoVersion(fs.readFileSync("rokit.toml", "utf8")));
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

	it.each(projects)(
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

	it.each(globProjects)(
		"should write the globIgnorePaths project %s back and build the same place",
		(name) => {
			const result = roundTrip(bundle.cli, name, GLOB_PROJECTS_DIR);

			expect(result.rogen).toMatchObject({ status: 0, stderr: "" });
			expect(result.written).toEqual(result.original);
			expect(result.placeOfWritten).toBeDefined();
			expect(result.placeOfWritten).toBe(result.placeOfOriginal);
		},
		30_000
	);
});
