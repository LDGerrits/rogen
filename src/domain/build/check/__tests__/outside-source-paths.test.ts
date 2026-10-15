import { DiagnosticSeverity } from "../../../../platform/diagnostics/diagnostic.js";
import { OutsideSourcePaths } from "../outside-source-paths.js";

describe("OutsideSourcePaths", () => {
	const outside = new OutsideSourcePaths(["/repo/src", "/repo/game/lib"]);

	describe("about", () => {
		it.each([
			["/repo/scr/A.luau", "scr", "src"],
			["/repo/srcc/deep/A.luau", "srcc", "src"],
			["/repo/game/lbi/A.luau", "lbi", "lib"],
		])(
			"should warn of %s, whose folder %s is one edit from %s",
			(file, folder, name) => {
				expect(outside.about(file)).toEqual([
					{
						severity: DiagnosticSeverity.Warning,
						code: "scan.outsideSourcePaths",
						resource: file,
						message: expect.stringContaining(
							`"${folder}" is one edit from the source path "${name}"`
						),
					},
				]);
			}
		);

		it.each([
			"/repo/README.md",
			"/repo/docs/A.luau",
			"/repo/src/A.luau",
			"/elsewhere/scr/A.luau",
			"/repo/sr/A.luau",
		])("should not warn of %s", (file) => {
			expect(outside.about(file)).toEqual([]);
		});
	});
});
