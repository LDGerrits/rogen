import { PlaceFolder } from "../place-folder.js";

describe("PlaceFolder", () => {
	it("should keep a place's code under places", () => {
		expect(PlaceFolder.pathOf("lobby")).toBe("places/lobby");
	});

	it.each([
		[["places/shared/src"], "places/lobby"],
		[["projects/shared/src"], "projects/lobby"],
		[["lib/core"], "lib/lobby"],
		[["src"], "places/lobby"],
		[["shared"], "places/lobby"],
	])(
		"should put a place beside the shared folder of %j",
		(rootDirs, folder) => {
			expect(PlaceFolder.pathOf("lobby", rootDirs)).toBe(folder);
		}
	);
});
