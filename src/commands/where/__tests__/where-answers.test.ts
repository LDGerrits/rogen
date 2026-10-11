import { answersOf } from "./where-fixtures.js";
import {
	Asked,
	FileLocation,
	InstanceLocation,
} from "../../../domain/build/build-service.js";
import { InstanceReference } from "../../../domain/roblox/roblox.js";

const placed = (source: string, at: string): FileLocation => ({
	status: "placed",
	source,
	exists: true,
	instancePath: ["ReplicatedStorage", at],
	route: "*",
	routeMatch: "fallback",
	variants: [],
});

const instance = (text: string, files: FileLocation[]): InstanceLocation => ({
	reference: InstanceReference.parse(text)!,
	files: files as InstanceLocation["files"],
	folders: [],
	fixes: [],
});

describe("WhereAnswers", () => {
	const sources = (
		files: FileLocation[],
		instances: InstanceLocation[],
		asked: Asked[]
	) =>
		answersOf([["default", files, instances]], false, [], {}, asked)
			.bySource()
			.map(([answer]) =>
				answer.kind === "file"
					? answer.location.source
					: answer.instance
			);

	it("should answer in the order things were asked, instances among the paths", () => {
		expect(
			sources(
				[
					placed("/repo/src/A.luau", "A"),
					placed("/repo/src/C.luau", "C"),
				],
				[instance("ServerScriptService.Nowhere", [])],
				[
					{ path: "/repo/src/A.luau" },
					{ instance: "ServerScriptService.Nowhere" },
					{ path: "/repo/src/C.luau" },
				]
			)
		).toEqual([
			"/repo/src/A.luau",
			"ServerScriptService.Nowhere",
			"/repo/src/C.luau",
		]);
	});

	it("should put the files an instance finds where the instance was asked", () => {
		expect(
			sources(
				[placed("/repo/src/Z.luau", "Z")],
				[
					instance("ReplicatedStorage.A", [
						placed("/repo/src/A.luau", "A"),
					]),
				],
				[
					{ instance: "ReplicatedStorage.A" },
					{ path: "/repo/src/Z.luau" },
				]
			)
		).toEqual(["/repo/src/A.luau", "/repo/src/Z.luau"]);
	});

	it("should keep the files of a directory together, where the directory was asked", () => {
		expect(
			sources(
				[
					placed("/repo/src/Net/B.luau", "B"),
					placed("/repo/src/Net/A.luau", "A"),
					placed("/repo/src/Z.luau", "Z"),
				],
				[],
				[{ path: "/repo/src/Net" }, { path: "/repo/src/Z.luau" }]
			)
		).toEqual([
			"/repo/src/Net/B.luau",
			"/repo/src/Net/A.luau",
			"/repo/src/Z.luau",
		]);
	});

	it("should keep a file asked about twice where it was first asked", () => {
		expect(
			sources(
				[
					placed("/repo/src/A.luau", "A"),
					placed("/repo/src/B.luau", "B"),
				],
				[],
				[
					{ path: "/repo/src/B.luau" },
					{ path: "/repo/src/A.luau" },
					{ path: "/repo/src" },
				]
			)
		).toEqual(["/repo/src/B.luau", "/repo/src/A.luau"]);
	});
});
