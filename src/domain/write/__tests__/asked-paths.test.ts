import { FileLocation, ConfigLocations } from "../write-service.js";
import { AskedPaths, outsideEveryConfig } from "../asked-paths.js";
import { abs, configOf } from "./fixtures.js";

const located = (files: readonly FileLocation[]): ConfigLocations => ({
	config: configOf(),
	files,
	instances: [],
	queried: [],
	diagnostics: [],
	markers: [],
});

const at = (source: string, status: "outside" | "placed"): FileLocation =>
	status === "outside"
		? { status, source: abs(source), exists: true }
		: {
				status,
				source: abs(source),
				exists: true,
				instancePath: ["ReplicatedStorage", source],
				route: "*",
				routeMatch: "fallback",
			};

describe("outsideEveryConfig", () => {
	it("should keep a path only when every config leaves it outside", () => {
		const lobby = located([
			at("a.luau", "outside"),
			at("b.luau", "outside"),
		]);
		const arena = located([
			at("a.luau", "outside"),
			at("b.luau", "placed"),
		]);

		expect(outsideEveryConfig([lobby, arena])).toEqual([abs("a.luau")]);
	});
});

describe("AskedPaths", () => {
	const asked = new AskedPaths(
		[abs("a.luau")],
		[{ path: abs("a.luau") }],
		{ groups: [], uncovered: [0] },
		new Map([[0, []]])
	);

	it("should list a path no config covers once, however many parts skip it", () => {
		const part = {
			diagnostics: [],
			stoppedBy: [],
			failing: [],
			skipped: asked.uncovered,
		};

		expect(asked.mergeDiagnoses([part, part]).skipped).toEqual([
			{ path: abs("a.luau"), reason: "noConfig" },
		]);
	});
});
