import {
	DiagnosticSeverity,
	errorDiagnostic,
	warningDiagnostic,
} from "../diagnostic.js";
import { diagnosticAnnotationLines } from "../diagnostic-annotation-lines.js";

describe("diagnosticAnnotationLines", () => {
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

		expect(diagnosticAnnotationLines(diagnostic, workspace)).toEqual([
			'::error file=default.rogen.json,line=3,col=2,title=config.unknownField::unknown field "outDir".',
		]);
	});

	it("should leave out the line when the diagnostic is about a whole file", () => {
		const diagnostic = warningDiagnostic(
			"tree.deadScript",
			{ resource: "/work/repo/src/Dead.luau" },
			"never runs."
		);

		expect(diagnosticAnnotationLines(diagnostic, workspace)).toEqual([
			"::warning file=src/Dead.luau,title=tree.deadScript::never runs.",
		]);
	});

	it("should write a path inside the workspace with slashes, whatever the system writes", () => {
		const diagnostic = warningDiagnostic(
			"x.y",
			{ resource: "/work/repo/src/A/B.luau" },
			"m"
		);

		expect(diagnosticAnnotationLines(diagnostic, workspace)[0]).toContain(
			"file=src/A/B.luau,"
		);
	});

	it("should name no file for a diagnostic about something outside the workspace", () => {
		const diagnostic = errorDiagnostic(
			"serve.noServer",
			{ resource: "/home/me/rokit.toml" },
			"none."
		);

		expect(diagnosticAnnotationLines(diagnostic, workspace)).toEqual([
			"::error title=serve.noServer::none.",
		]);
	});

	it("should write the paths in the message relative to the workspace", () => {
		const diagnostic = errorDiagnostic(
			"output.sameOutFile",
			{ resource: "/work/repo/a.rogen.json" },
			"both write /work/repo/out/a.project.json."
		);

		expect(diagnosticAnnotationLines(diagnostic, workspace)[0]).toBe(
			"::error file=a.rogen.json,title=output.sameOutFile::both write out/a.project.json."
		);
	});

	it("should escape what a workflow command would read as its own syntax", () => {
		const diagnostic = errorDiagnostic(
			"a.b",
			{ resource: "/work/repo/odd,name:x.luau" },
			"100% of it\nand more"
		);

		expect(diagnosticAnnotationLines(diagnostic, workspace)).toEqual([
			"::error file=odd%2Cname%3Ax.luau,title=a.b::100%25 of it%0Aand more",
		]);
	});

	it("should write one annotation for each file a grouped warning is about, and none for the summary line", () => {
		const diagnostic = warningDiagnostic(
			"route.strayAt",
			{ resource: "/work/repo/default.rogen.json" },
			'2 files have a stray @.\nsrc/A@sever.luau - did you mean "@server"?\nsrc/B@clent.luau - did you mean "@client"?',
			[],
			[
				{
					resource: "/work/repo/src/A@sever.luau",
					message: 'did you mean "@server"?',
				},
				{
					resource: "/work/repo/src/B@clent.luau",
					message: 'did you mean "@client"?',
				},
			]
		);

		expect(diagnosticAnnotationLines(diagnostic, workspace)).toEqual([
			'::warning file=src/A@sever.luau,title=route.strayAt::did you mean "@server"?',
			'::warning file=src/B@clent.luau,title=route.strayAt::did you mean "@client"?',
		]);
	});

	it("should keep the severity", () => {
		expect(
			diagnosticAnnotationLines(
				{
					resource: "/work/repo/a.luau",
					severity: DiagnosticSeverity.Warning,
					code: "a.b",
					message: "m",
				},
				workspace
			)[0]
		).toMatch(/^::warning /);
	});
});
