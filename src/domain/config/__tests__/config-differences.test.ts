import { ConfigDifferences } from "../config-differences.js";
import { ResolvedConfigSpec, mockConfig } from "./mock-config-service.js";

const config = (spec: ResolvedConfigSpec = {}) =>
	mockConfig({
		sourcePaths: ["/repo/src"],
		routes: { "*": "ReplicatedStorage" },
		project: { name: "Game", tree: { $className: "DataModel" } },
		...spec,
	});

describe("ConfigDifferences", () => {
	it("should find nothing between equal configs", () => {
		expect(ConfigDifferences.between(config(), config())).toEqual([]);
	});

	it("should name the Rojo keys whose values differ, and those only one has", () => {
		const other = config({
			project: {
				name: "Game",
				servePort: 34900,
				tree: { $className: "DataModel", Workspace: {} },
			},
		});

		expect(ConfigDifferences.between(config(), other)).toEqual([
			"tree",
			"servePort",
		]);
	});

	it("should name Rogen's keys after Rojo's", () => {
		const other = config({
			project: { name: "Other", tree: { $className: "DataModel" } },
			sourcePaths: ["/repo/src", "/repo/dev"],
			routes: { "*": "Workspace" },
			syncPath: "/repo/dist",
		});

		expect(ConfigDifferences.between(config(), other)).toEqual([
			"name",
			"sourcePaths",
			"routes",
			"syncPath",
		]);
	});
});
