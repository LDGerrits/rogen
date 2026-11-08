import { describeWithRojo } from "../src/domain/rojo/__tests__/rojo-cli.js";
import { PARITY_PROJECTS, parityRunners } from "./rojo-parity.js";

const SOURCEMAP_FLAGS = [
	[],
	["--include-non-scripts"],
	["--absolute"],
	["--include-non-scripts", "--absolute"],
];

/** `json` without `folder`, which Rojo writes with `/` on every platform. */
const withoutFolder = (json: string, folder: string): string =>
	json.split(folder.replaceAll("\\", "/")).join("");

describeWithRojo("Rogen and Rojo on the same project", () => {
	const { rogen, rojo, copies } = parityRunners();

	describe("a build test of Rojo's", () => {
		it.each(PARITY_PROJECTS)(
			"should write the sourcemap of %s as Rojo does, with each flag",
			(name) => {
				const { byRojo, byRogen } = copies(name);
				const differing = SOURCEMAP_FLAGS.filter((flags) => {
					const expected = rojo(byRojo, [
						"sourcemap",
						...flags,
						"default.project.json",
					]);
					const actual = rogen(byRogen, ["sourcemap", ...flags]);
					return (
						expected.status !== 0 ||
						actual.status !== 0 ||
						withoutFolder(actual.stdout, byRogen) !==
							withoutFolder(expected.stdout, byRojo)
					);
				});

				expect(differing).toEqual([]);
			},
			60_000
		);
	});
});
