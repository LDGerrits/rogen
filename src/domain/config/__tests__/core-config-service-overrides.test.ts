import {
	useConfigFixture,
	selection,
	write,
	start,
	resolved,
} from "./config-fixture.js";

describe("CoreConfigService", () => {
	useConfigFixture();

	describe("overrides", () => {
		it("should apply outFile against the working directory", async () => {
			await write("/repo/default.rogen.json", {
				outFile: "old.project.json",
			});

			await start({ overrides: { outFile: "out/new.project.json" } });

			expect(resolved(0)).toMatchObject({
				outFile: "/repo/out/new.project.json",
			});
		});

		it("should keep the overrides across a reload", async () => {
			await write("/repo/default.rogen.json", { rootDirs: ["a"] });
			await start({ overrides: { outFile: "out.project.json" } });

			await write("/repo/default.rogen.json", { rootDirs: ["b"] });
			await selection.reload(["/repo/default.rogen.json"]);

			expect(resolved(0)).toMatchObject({
				rootDirs: ["/repo/b"],
				outFile: "/repo/out.project.json",
			});
		});
	});
});
