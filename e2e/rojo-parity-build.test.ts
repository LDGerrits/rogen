import fs from "fs";
import path from "path";
import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { PARITY_PROJECTS, parityRunners } from "./rojo-parity.js";

const FORMATS = ["rbxl", "rbxm", "rbxlx"];

describeWithRojo("Rogen and Rojo on the same project", () => {
	const { rogen, rojo, copies } = parityRunners();

	describe("a build test of Rojo's", () => {
		it.each(PARITY_PROJECTS)(
			"should build %s into each format as Rojo does",
			(name) => {
				const { dir, byRojo, byRogen } = copies(name);
				const differing = FORMATS.filter((format) => {
					const expected = rojo(byRojo, [
						"build",
						"default.project.json",
						"-o",
						path.join(dir, `rojo.${format}`),
					]);
					const actual = rogen(byRogen, [
						"build",
						"-o",
						path.join(dir, `rogen.${format}`),
					]);
					return (
						expected.status !== 0 ||
						actual.status !== 0 ||
						!fs
							.readFileSync(path.join(dir, `rogen.${format}`))
							.equals(
								fs.readFileSync(
									path.join(dir, `rojo.${format}`)
								)
							)
					);
				});

				expect(differing).toEqual([]);
			},
			60_000
		);
	});
});
