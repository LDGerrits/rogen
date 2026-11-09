import {
	Diagnostic,
	errorDiagnostic,
	warningDiagnostic,
} from "../../../platform/diagnostics/diagnostic.js";
import {
	ConfigLocations,
	FileLocation,
	LocatedDiagnosis,
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
							pattern: "*.aly",
							use: "moduleScript",
							suffix: ".aly",
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
				expect(codesOf(placed("src/Boot.server.aly"))).toEqual([
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
