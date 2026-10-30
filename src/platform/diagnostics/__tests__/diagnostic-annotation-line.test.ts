import {
	DiagnosticSeverity,
	errorDiagnostic,
	warningDiagnostic,
} from "../diagnostic.js";
import { diagnosticAnnotationLine } from "../diagnostic-annotation-line.js";

describe("diagnosticAnnotationLine", () => {
	const workspace = "/work/repo";

	it("should point an error at the line and column of its file, titled by its code", () => {
		const diagnostic = errorDiagnostic(
			"config.unknownField",
			{
				resource: "/work/repo/default.rogen.json",
				position: { line: 3, column: 2 },
			},
			'unknown field "outDir".'
		);

		expect(diagnosticAnnotationLine(diagnostic, workspace)).toBe(
			'::error file=default.rogen.json,line=3,col=2,title=config.unknownField::unknown field "outDir".'
		);
	});

	it("should leave out the line when the diagnostic is about a whole file", () => {
		const diagnostic = warningDiagnostic(
			"tree.deadScript",
			{ resource: "/work/repo/src/Dead.luau" },
			"never runs."
		);

		expect(diagnosticAnnotationLine(diagnostic, workspace)).toBe(
			"::warning file=src/Dead.luau,title=tree.deadScript::never runs."
		);
	});

	it("should write a path inside the workspace with slashes, whatever the system writes", () => {
		const diagnostic = warningDiagnostic(
			"x.y",
			{ resource: "/work/repo/src/A/B.luau" },
			"m"
		);

		expect(diagnosticAnnotationLine(diagnostic, workspace)).toContain(
			"file=src/A/B.luau,"
		);
	});

	it("should name no file for a diagnostic about something outside the workspace", () => {
		const diagnostic = errorDiagnostic(
			"rojo.notFound",
			{ resource: "/home/me/rokit.toml" },
			"none."
		);

		expect(diagnosticAnnotationLine(diagnostic, workspace)).toBe(
			"::error title=rojo.notFound::none."
		);
	});

	it("should write the paths in the message relative to the workspace", () => {
		const diagnostic = errorDiagnostic(
			"output.sameProjectFile",
			{ resource: "/work/repo/a.rogen.json" },
			"both write /work/repo/out/a.project.json."
		);

		expect(diagnosticAnnotationLine(diagnostic, workspace)).toBe(
			"::error file=a.rogen.json,title=output.sameProjectFile::both write out/a.project.json."
		);
	});

	it("should escape what a workflow command would read as its own syntax", () => {
		const diagnostic = errorDiagnostic(
			"a.b",
			{ resource: "/work/repo/odd,name:x.luau" },
			"100% of it\nand more"
		);

		expect(diagnosticAnnotationLine(diagnostic, workspace)).toBe(
			"::error file=odd%2Cname%3Ax.luau,title=a.b::100%25 of it%0Aand more"
		);
	});

	it("should keep the severity", () => {
		expect(
			diagnosticAnnotationLine(
				{
					resource: "/work/repo/a.luau",
					severity: DiagnosticSeverity.Warning,
					code: "a.b",
					message: "m",
				},
				workspace
			)
		).toMatch(/^::warning /);
	});
});
