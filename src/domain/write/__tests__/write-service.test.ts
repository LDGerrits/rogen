import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import { InstanceReference } from "../../roblox/roblox.js";
import {
	ConfigLocations,
	FileLocation,
	LocatedDiagnosis,
	skippedNotes,
} from "../write-service.js";
import { abs, absPosix, configOf } from "./fixtures.js";

const placed = (source: string): FileLocation => ({
	status: "placed",
	source: abs(source),
	exists: true,
	instancePath: ["ReplicatedStorage", source],
	route: "*",
	routeMatch: "fallback",
});

const located = (
	files: readonly FileLocation[],
	diagnostics: readonly Diagnostic[],
	queried: readonly string[] = [],
	markers: readonly string[] = [],
	config = configOf()
): ConfigLocations => ({
	config,
	files,
	instances: [],
	queried: queried.map((target) => abs(target)),
	diagnostics,
	markers: markers.map((marker) => absPosix(marker)),
});

const error = (resource: string, code = "x.error") =>
	errorDiagnostic(code, { resource: abs(resource) }, "stops");

const warning = (resource: string, code = "x.warning") =>
	warningDiagnostic(code, { resource: abs(resource) }, "odd");

describe("LocatedDiagnosis", () => {
	describe("of", () => {
		const folder = warning("src/F", "x.folder");
		const marker = warning("src/F/@Server", "x.marker");
		const meta = error("src/F/A.meta.json", "x.meta");
		const own = warning("src/F/A.luau", "x.own");
		const all = [folder, marker, meta, own];

		it("should give a path asked about what is about it, its folder, the marker of its folder and its meta file", () => {
			const diagnosis = new LocatedDiagnosis(
				located(
					[placed("src/F/A.luau")],
					all,
					["src/F/A.luau"],
					["src/F/@Server"]
				)
			);

			expect(
				diagnosis.of(placed("src/F/A.luau")).map(({ code }) => code)
			).toEqual(["x.folder", "x.marker", "x.meta", "x.own"]);
		});

		it("should give a file found in a folder only what is about it or its meta file", () => {
			const diagnosis = new LocatedDiagnosis(
				located(
					[placed("src/F/A.luau")],
					all,
					["src/F"],
					["src/F/@Server"]
				)
			);

			expect(
				diagnosis.of(placed("src/F/A.luau")).map(({ code }) => code)
			).toEqual(["x.meta", "x.own"]);
		});

		describe("for a script of a compiled language", () => {
			const compiling = configOf({
				compiledPath: abs("out"),
				project: {
					tree: {},
					syncRules: [
						{
							pattern: "*.lang",
							use: "moduleScript",
							suffix: ".lang",
						},
					],
				},
			});
			const codesOf = (location: FileLocation) =>
				new LocatedDiagnosis(
					located(
						[location],
						[
							error("src/Boot.meta.json", "x.compiled"),
							error("src/Boot.server.meta.json", "x.rojo"),
						],
						[],
						[],
						compiling
					)
				)
					.of(location)
					.map(({ code }) => code);

			it("should read a scanned source as the scan does", () => {
				expect(codesOf(placed("src/Boot.server.lang"))).toEqual([
					"x.compiled",
				]);
			});
		});

		it("should give a path asked about that is not placed what reaches it", () => {
			const missing: FileLocation = {
				status: "missing",
				source: abs("src/A.luau"),
				exists: false,
			};
			const stop = error("src", "scan.missingSourcePath");

			expect(
				new LocatedDiagnosis(
					located([missing], [stop], ["src/A.luau"])
				).of(missing)
			).toEqual([stop]);
		});
	});

	describe("stoppedBy", () => {
		it("should hold the errors that reach no path asked about", () => {
			const inside = error("src/F/Bad.luau");
			const elsewhere = error("src/G/Bad.luau");

			const diagnosis = new LocatedDiagnosis(
				located(
					[placed("src/F/A.luau")],
					[inside, elsewhere],
					["src/F"]
				)
			);

			expect(diagnosis.reaching).toEqual([inside]);
			expect(diagnosis.stoppedBy).toEqual([elsewhere]);
		});
	});

	describe("unshown", () => {
		it("should hold the errors no line shows, the ones that reach a folder asked about included", () => {
			const folderMeta = error("src/F/init.meta.json");
			const elsewhere = error("src/G/Bad.luau");
			const shown = error("src/F/A.luau");

			const diagnosis = new LocatedDiagnosis(
				located(
					[placed("src/F/A.luau")],
					[folderMeta, elsewhere, shown],
					["src/F"]
				)
			);

			expect(diagnosis.unshown).toEqual([folderMeta, elsewhere]);
			expect(diagnosis.stoppedBy).toEqual([elsewhere]);
		});

		it("should be empty beside a blocked path, which names what stops the write", () => {
			const stop = error("src/F/Bad@server.luau");
			const other = error("src/F/Worse@client.luau");
			const blocked: FileLocation = {
				status: "blocked",
				source: abs("src/F/Good.luau"),
				exists: true,
				by: stop,
				own: false,
			};

			const diagnosis = new LocatedDiagnosis(
				located([blocked], [stop, other], ["src/F/Good.luau"])
			);

			expect(diagnosis.unshown).toEqual([]);
			expect(diagnosis.stops).toEqual([stop, other]);
		});
	});
});

describe("LocatedDiagnosis of an instance asked about", () => {
	it("should give it the diagnostic whose rename places it, and no other", () => {
		const proposing = error("src/Buy.Server.luau", "route.dotRoute");
		const sameCode = error("src/Other.Server.luau", "route.dotRoute");
		const sameFile = warning("src/Buy.Server.luau", "x.other");
		const asked: ConfigLocations = {
			...located([], [proposing, sameCode, sameFile]),
			instances: [
				{
					reference: InstanceReference.parse(
						"ServerScriptService.Buy"
					)!,
					files: [],
					folders: [],
					fixes: [
						{
							code: "route.dotRoute",
							rename: {
								from: absPosix("src/Buy.Server.luau"),
								to: absPosix("src/Buy.server.luau"),
							},
						},
					],
				},
			],
		};

		expect(new LocatedDiagnosis(asked).reaching).toEqual([proposing]);
	});
});

describe("skippedNotes", () => {
	const ask = { command: "check", lead: "Check it" };

	const notesOf = (
		skipped: Parameters<typeof skippedNotes>[0]["skipped"],
		named: string[] = []
	) => skippedNotes({ skipped, named }, "/repo", ask);

	it("should point at the one config that reads a path", () => {
		expect(
			notesOf([
				{
					path: "/repo/shared/A.luau",
					reason: "noConfig",
					readers: ["/repo/lobby/default.rogen.json"],
				},
			])
		).toEqual([
			"note: shared/A.luau: no config at or above it reads it, but another config lists it in its source paths. Check it through that config: 'rogen check lobby/default.rogen.json'.",
		]);
	});

	it("should name no config to go through when there is none", () => {
		expect(
			notesOf([{ path: "/repo/shared/A.luau", reason: "noConfig" }])
		).toEqual(["note: shared/A.luau: no config at or above it reads it."]);
	});

	it("should name the configs here to go through", () => {
		expect(
			notesOf(
				[{ path: "/repo/shared/A.luau", reason: "noConfig" }],
				["/repo/game.rogen.json", "/repo/lobby.rogen.json"]
			)
		).toEqual([
			"note: shared/A.luau: no config at or above it reads it. Check it through one: rogen check game.rogen.json or lobby.rogen.json.",
		]);
	});
});
