import { toPosix } from "../../../base/path.js";
import {
	Diagnostic,
	isAbout,
	reaches,
	warningDiagnostic,
} from "../diagnostic.js";
import { DiagnosticIndex } from "../diagnostic-index.js";

describe("platform/diagnostics/diagnostic-index", () => {
	const diagnostics: Diagnostic[] = [
		warningDiagnostic("a.folder", { resource: "/p/src/Shop" }, "folder"),
		warningDiagnostic(
			"a.file",
			{ resource: "/p/src/Shop/Cart.luau" },
			"file"
		),
		warningDiagnostic(
			"a.related",
			{ resource: "/p/src/Shop/Pay.luau" },
			"several",
			[],
			[{ resource: "/p/src/Other/Pay.luau", message: "twin" }]
		),
		warningDiagnostic(
			"a.meta",
			{ resource: "/p/src/Shop/Cart.meta.json" },
			"meta"
		),
		warningDiagnostic(
			"a.marker",
			{ resource: "/p/src/Shop/Cart@Server.luau" },
			"marker"
		),
		warningDiagnostic(
			"a.config",
			{ resource: "/p/default.rogen.json" },
			"config"
		),
	];
	const markers = new Set(["/p/src/Shop/Cart@Server.luau"]);
	const folderOf = ({ resource }: Diagnostic) =>
		markers.has(resource) ? "/p/src/Shop" : resource;
	const index = new DiagnosticIndex(diagnostics, folderOf);
	const targets = [
		"/p/src/Shop",
		"/p/src/Shop/Cart.luau",
		"/p/src/Shop/Pay.luau",
		"/p/src/Other/Pay.luau",
		"/p/src/Other",
		"/p/src",
		"/p/src/Shop/Deep/New.luau",
		"/p/default.rogen.json",
		"/q",
	];

	it.each(targets)("should find what reaches asks for %s", (target) => {
		const metaPaths = ["/p/src/Shop/Cart.meta.json"];
		const expected = diagnostics.filter(
			(diagnostic) =>
				reaches(diagnostic, target, folderOf(diagnostic)) ||
				metaPaths.includes(toPosix(diagnostic.resource))
		);

		expect(index.reaching(target, metaPaths)).toEqual(expected);
	});

	it.each(targets)("should find what isAbout asks for %s", (target) => {
		const expected = diagnostics.filter((diagnostic) =>
			isAbout(diagnostic, target)
		);

		expect(index.about(target, [])).toEqual(expected);
	});

	it("should ignore case in a folder where the file system does", () => {
		const folding = new DiagnosticIndex(diagnostics, folderOf, true);
		const exact = new DiagnosticIndex(diagnostics, folderOf, false);

		expect(folding.reaching("/P/SRC/SHOP/Cart.luau", [])).toEqual([
			diagnostics[0],
			diagnostics[1],
			diagnostics[4],
		]);
		expect(exact.reaching("/P/SRC/SHOP/Cart.luau", [])).toEqual([]);
	});

	it("should list a diagnostic once, in the order given", () => {
		expect(
			index.about("/p/src/Shop/Cart.luau", ["/p/src/Shop/Cart.meta.json"])
		).toEqual([diagnostics[1], diagnostics[3]]);
	});
});
