import { FileLocation } from "../../../domain/build/build-service.js";
import { LocationReport } from "../location-report.js";

const describe1 = (location: FileLocation) => {
	const report = new LocationReport("/repo");
	report.add("default", [location]);
	return report.lines()[0];
};

describe("LocationReport", () => {
	describe("a location", () => {
		it("should give the instance path, the route and how it matched", () => {
			expect(
				describe1({
					status: "placed",
					source: "/repo/src/Net/HttpClient.luau",
					instancePath: [
						"StarterPlayer",
						"StarterPlayerScripts",
						"Http",
					],
					route: "Client",
					routeMatch: "capital",
					tags: [],
				})
			).toBe(
				"src/Net/HttpClient.luau -> StarterPlayer/StarterPlayerScripts/Http · route Client (capital suffix)"
			);
		});

		it("should name each active tag with how it matched", () => {
			expect(
				describe1({
					status: "placed",
					source: "/repo/src/A.luau",
					instancePath: ["ReplicatedStorage", "A"],
					route: "*",
					routeMatch: "fallback",
					tags: [
						{ tag: "dev", form: "folder" },
						{ tag: "mock", form: "separator" },
						{ tag: "test", form: "marker" },
					],
				})
			).toBe(
				"src/A.luau -> ReplicatedStorage/A · route * (fallback) · tags dev (folder), mock (suffix), test (marker)"
			);
		});

		it("should say how a dormant tag matched a pruned file", () => {
			expect(
				describe1({
					status: "pruned",
					source: "/repo/src/HttpMock.luau",
					tags: [
						{
							tag: "mock",
							form: "capital",
							separatorName: "Http.mock.luau",
						},
					],
				})
			).toBe(
				"src/HttpMock.luau -> pruned · tag mock is off (capital suffix)"
			);
		});

		it("should name the glob that excluded a path, relative to the working directory", () => {
			expect(
				describe1({
					status: "excluded",
					source: "/repo/src/A.spec.luau",
					pattern: "/repo/**/*.spec.luau",
				})
			).toBe("src/A.spec.luau -> excluded · matches **/*.spec.luau");
		});

		it.each<[FileLocation, string]>([
			[
				{
					status: "replaced",
					source: "/repo/src/T.lua",
					by: "/repo/src/T.luau",
				},
				"src/T.lua -> replaced by src/T.luau",
			],
			[
				{
					status: "displaced",
					source: "/repo/src/Save.luau",
					node: ["ServerScriptService", "Save"],
				},
				"src/Save.luau -> displaced · the template defines ServerScriptService/Save",
			],
			[
				{ status: "unrouted", source: "/repo/src/U.luau" },
				"src/U.luau -> unrouted · no route matches it",
			],
			[
				{ status: "outside", source: "/repo/README.md" },
				"README.md -> outside the root dirs",
			],
			[
				{ status: "ignored", source: "/repo/src/N.md" },
				"src/N.md -> not an instance",
			],
			[
				{ status: "missing", source: "/repo/src/X" },
				"src/X -> does not exist",
			],
			[
				{ status: "empty", source: "/repo/src/E" },
				"src/E -> empty · no file in it places",
			],
			[
				{ status: "skipped", source: "/repo/src/L" },
				"src/L -> skipped · the link loops or points at nothing",
			],
		])("should describe %j", (location, line) => {
			expect(describe1(location)).toBe(line);
		});
	});

	describe("several configs", () => {
		const outside = (name: string): FileLocation => ({
			status: "outside",
			source: `/repo/${name}`,
		});
		const missing = (name: string): FileLocation => ({
			status: "missing",
			source: `/repo/${name}`,
		});
		const report = (
			configs: [label: string, locations: FileLocation[]][]
		) => {
			const built = new LocationReport("/repo");
			for (const [label, locations] of configs)
				built.add(label, locations);
			return built;
		};

		it("should print one config's lines as they are", () => {
			expect(report([["default", [outside("a")]]]).lines()).toEqual([
				"a -> outside the root dirs",
			]);
		});

		it("should print a line once when every config gives the same one", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [outside("a")]],
				]).lines()
			).toEqual(["a -> outside the root dirs"]);
		});

		it("should prefix each config's line when they differ", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [missing("a")]],
				]).lines()
			).toEqual([
				"default: a -> outside the root dirs",
				"lobby: a -> does not exist",
			]);
		});

		it("should prefix a line that only some configs have", () => {
			expect(
				report([
					["default", [outside("a")]],
					["lobby", [outside("a"), missing("b")]],
				]).lines()
			).toEqual([
				"a -> outside the root dirs",
				"lobby: b -> does not exist",
			]);
		});

		it("should keep the order the paths were first given in", () => {
			expect(
				report([["default", [missing("b"), missing("a")]]]).lines()
			).toEqual(["b -> does not exist", "a -> does not exist"]);
		});

		it("should sort the paths when asked to", () => {
			expect(
				report([
					["default", [missing("b")]],
					["lobby", [outside("a")]],
				]).lines(true)
			).toEqual([
				"lobby: a -> outside the root dirs",
				"default: b -> does not exist",
			]);
		});
	});
});
