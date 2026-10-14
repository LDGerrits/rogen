import { ProjectChoice } from "../project-choice.js";
import { mockConfig } from "./mock-config-service.js";

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
						new Map([["/repo/arena/rogen.json", "release"]])
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
							["/repo/lobby/rogen.json", "default"],
							["/repo/arena/rogen.json", "release"],
						])
					)
				)
			).toEqual([
				"/repo/lobby/rogen.json#default",
				"/repo/arena/rogen.json#release",
			]);
		});
	});
});
