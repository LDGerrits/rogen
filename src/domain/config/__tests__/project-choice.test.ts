import { ProjectChoice } from "../project-choice.js";
import { mockConfig } from "./mock-config-service.js";

const only = (name: string) => ({ names: [name], usual: false });

describe("ProjectChoice", () => {
	const project = (file: string, stem: string, serveProject = "default") =>
		mockConfig({ file, stem, serveProject });

	const lobby = [
		project("/repo/lobby/rogen.json", "default", "dist"),
		project("/repo/lobby/rogen.json", "dist", "dist"),
	];
	const arena = [
		project("/repo/arena/rogen.json", "default"),
		project("/repo/arena/rogen.json", "release"),
	];
	const stems = (configs: readonly { file: string; stem: string }[]) =>
		configs.map(({ file, stem }) => `${file}#${stem}`);

	describe("read", () => {
		it("should take the description of each config", () => {
			expect(
				stems(ProjectChoice.read([...lobby, ...arena], new Map()))
			).toEqual([
				"/repo/lobby/rogen.json#default",
				"/repo/arena/rogen.json#default",
			]);
		});

		it("should take the project named for a config instead, and no other", () => {
			expect(
				stems(
					ProjectChoice.read(
						[...lobby, ...arena],
						new Map([["/repo/arena/rogen.json", only("release")]])
					)
				)
			).toEqual([
				"/repo/lobby/rogen.json#default",
				"/repo/arena/rogen.json#release",
			]);
		});
	});

	describe("served", () => {
		it("should take the project serveProject names for each config", () => {
			expect(
				stems(ProjectChoice.served([...lobby, ...arena], new Map()))
			).toEqual([
				"/repo/lobby/rogen.json#dist",
				"/repo/arena/rogen.json#default",
			]);
		});

		it("should take the project named for a config over serveProject", () => {
			expect(
				stems(
					ProjectChoice.served(
						[...lobby, ...arena],
						new Map([
							["/repo/lobby/rogen.json", only("default")],
							["/repo/arena/rogen.json", only("release")],
						])
					)
				)
			).toEqual([
				"/repo/lobby/rogen.json#default",
				"/repo/arena/rogen.json#release",
			]);
		});
	});
	describe("with places", () => {
		const root = mockConfig({
			file: "/repo/rogen.json",
			hasPlaces: true,
		});
		const places = ["lobby", "arena"].flatMap((name) =>
			["default", "release"].map((stem) =>
				mockConfig({
					file: `/repo/places/${name}/rogen.json`,
					rootFile: "/repo/rogen.json",
					isPlace: true,
					stem,
				})
			)
		);
		const everything = [root, ...places];

		it("should serve the places and never the config that lists them", () => {
			expect(stems(ProjectChoice.served(everything, new Map()))).toEqual([
				"/repo/places/lobby/rogen.json#default",
				"/repo/places/arena/rogen.json#default",
			]);
		});

		it("should take serveProject and the projects named with it", () => {
			expect(
				stems(
					ProjectChoice.served(
						[...lobby, ...arena],
						new Map([
							[
								"/repo/lobby/rogen.json",
								{ names: ["default"], usual: true },
							],
						])
					)
				)
			).toEqual([
				"/repo/lobby/rogen.json#default",
				"/repo/lobby/rogen.json#dist",
				"/repo/arena/rogen.json#default",
			]);
		});

		it("should apply the project named for the listing config to its places", () => {
			const named = new Map([["/repo/rogen.json", only("release")]]);

			expect(stems(ProjectChoice.served(everything, named))).toEqual([
				"/repo/places/lobby/rogen.json#release",
				"/repo/places/arena/rogen.json#release",
			]);
			expect(stems(ProjectChoice.read(everything, named))).toEqual([
				"/repo/places/lobby/rogen.json#release",
				"/repo/places/arena/rogen.json#release",
			]);
		});

		it("should read the description of the listing config and of each place", () => {
			expect(stems(ProjectChoice.read(everything, new Map()))).toEqual([
				"/repo/rogen.json#default",
				"/repo/places/lobby/rogen.json#default",
				"/repo/places/arena/rogen.json#default",
			]);
		});
	});
});
