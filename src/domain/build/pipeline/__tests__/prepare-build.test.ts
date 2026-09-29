import { IndexReader } from "../../../../platform/fs/index-service.js";
import { abs, configOf, syncTools } from "../../__tests__/fixtures.js";
import { prepareBuild } from "../prepare-build.js";

const untouchedIndex: IndexReader = {
	getEntries: () => {
		throw new Error("the index was read");
	},
	hasEntry: () => {
		throw new Error("the index was read");
	},
	getEntryType: () => {
		throw new Error("the index was read");
	},
};

describe("prepareBuild", () => {
	const prepare = (overrides: Parameters<typeof configOf>[0] = {}) =>
		prepareBuild(untouchedIndex, configOf(overrides), syncTools);

	it("should fail when the config declares no routes", () => {
		const result = prepare({ routes: {} });

		expect(result.isErr() ? result.error : []).toMatchObject([
			{ code: "route.noRoutes", resource: abs("default.rogen.json") },
		]);
	});

	it("should report every route whose target's service is unsupported", () => {
		const result = prepare({
			routes: {
				server: "Nowhere",
				client: "Elsewhere/x",
				"*": "Workspace",
			},
		});

		expect(result.isErr() ? result.error : []).toMatchObject([
			{
				code: "roblox.unsupportedService",
				resource: abs("default.project.json"),
			},
			{
				code: "roblox.unsupportedService",
				resource: abs("default.project.json"),
			},
		]);
	});

	it("should parse each route's target", () => {
		const { targets } = prepare({
			routes: {
				server: "ServerScriptService",
				"*": "ReplicatedStorage/shared/Deep",
			},
		}).unwrap();

		expect([...targets]).toEqual([
			["server", { service: "ServerScriptService", folders: [] }],
			[
				"*",
				{
					service: "ReplicatedStorage",
					folders: ["shared", "Deep"],
				},
			],
		]);
	});

	it("should derive the declared keys from the routes and tags", () => {
		const { keys } = prepare({
			routes: { server: "ServerScriptService", "*": "Workspace" },
			tags: { mock: true },
		}).unwrap();

		expect([...keys.routeKeys]).toEqual(["server"]);
		expect([...keys.tagKeys]).toEqual(["mock"]);
	});

	it("should root the layout at the output's directory", () => {
		const { layout } = prepare({
			outFile: abs("out/game.project.json"),
		}).unwrap();

		expect(layout.projectDir).toBe(abs("out"));
	});

	it("should hold the template rebased to the output's directory", () => {
		const { template } = prepare({ name: "game" }).unwrap();

		expect(template.getTree()).toEqual({
			name: "game",
			tree: { $className: "DataModel" },
		});
	});
});
