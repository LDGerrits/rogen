import { DOCS_URL } from "../../product/product-service.js";
import path from "path";
import {
	Diagnostic,
	DiagnosticSeverity,
	diagnosticToJson,
	diagnosticsAbout,
	diagnosticsReaching,
	renderDiagnostic,
	warningDiagnostic,
} from "../diagnostic.js";

describe("platform/diagnostics/diagnostic", () => {
	describe("renderDiagnostic", () => {
		it("should render resource, position, severity and message", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				code: "test.example",
				message: 'unknown field "outDir".',
				resource: "lobby.rogen.json",
				position: { line: 7, column: 3 },
			};

			expect(renderDiagnostic(diagnostic)).toBe(
				'lobby.rogen.json:7:3 - error: unknown field "outDir". (test.example)'
			);
		});

		it("should leave the position out when there is none", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.example",
				message: "it contributes nothing.",
				resource: "/repo/src",
			};

			expect(renderDiagnostic(diagnostic)).toBe(
				"/repo/src - warning: it contributes nothing. (test.example)"
			);
		});

		it("should render the resource relative to a working directory", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.example",
				message: "it contributes nothing.",
				resource: "/repo/src/Net/HttpClient.luau",
			};

			expect(renderDiagnostic(diagnostic, "/repo")).toBe(
				"src/Net/HttpClient.luau - warning: it contributes nothing. (test.example)"
			);
			expect(
				renderDiagnostic(diagnostic, "/repo/src/Net/HttpClient.luau")
			).toBe(". - warning: it contributes nothing. (test.example)");
		});

		it("should put the code on the headline of a grouped message", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.group",
				message: "2 names are odd:\n  a\n  b",
				resource: "/repo/default.rogen.json",
			};

			expect(renderDiagnostic(diagnostic)).toBe(
				`${path.normalize("/repo/default.rogen.json")} - warning: 2 names are odd: (test.group)\n  a\n  b`
			);
		});

		it("should write the paths inside the message relative to the working directory too", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.example",
				message:
					'"a" is defined by /repo/src/A.luau and /repo/src/B.luau, not /repo2/src/C.luau.',
				resource: "/repo/default.project.json",
			};

			expect(renderDiagnostic(diagnostic, "/repo")).toBe(
				'default.project.json - warning: "a" is defined by src/A.luau and src/B.luau, not /repo2/src/C.luau. (test.example)'
			);
			expect(renderDiagnostic(diagnostic)).toContain("/repo/src/A.luau");
		});

		it.each([
			["/", "see /etc/foo", "see /etc/foo"],
			["/repo/", "see /repo/src/A.luau", "see src/A.luau"],
			["/repo", "see /mnt/repo/src/A.luau", "see /mnt/repo/src/A.luau"],
			["/repo", "(/repo/a, /repo/b)", "(a, b)"],
		])(
			"should strip the working directory %j from %j only at the start of a path",
			(cwd, message, expected) => {
				const diagnostic: Diagnostic = {
					severity: DiagnosticSeverity.Warning,
					code: "test.example",
					message,
					resource: "/elsewhere",
				};

				expect(renderDiagnostic(diagnostic, cwd)).toContain(
					` warning: ${expected}`
				);
			}
		);
	});

	describe("diagnosticToJson", () => {
		it("should name the file, position, severity, code, message and the code's docs", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Error,
				code: "test.example",
				message: 'unknown field "outDir".',
				resource: "/repo/lobby.rogen.json",
				position: { line: 7, column: 3 },
			};

			expect(diagnosticToJson(diagnostic)).toEqual({
				file: "/repo/lobby.rogen.json",
				line: 7,
				column: 3,
				severity: "error",
				code: "test.example",
				message: 'unknown field "outDir".',
				url: `${DOCS_URL}/diagnostics#test-example`,
			});
		});

		it("should leave the position out when there is none", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "test.example",
				message: "it contributes nothing.",
				resource: "/repo/src",
			};

			expect(diagnosticToJson(diagnostic)).toEqual({
				file: "/repo/src",
				severity: "warning",
				code: "test.example",
				message: "it contributes nothing.",
				url: `${DOCS_URL}/diagnostics#test-example`,
			});
		});

		it("should give each fix's paths as native paths, and leave fixes out when there are none", () => {
			const fixed = warningDiagnostic(
				"test.example",
				{ resource: "/repo/default.rogen.json" },
				"",
				[
					{
						rename: {
							from: "/repo/src/A@sever.luau",
							to: "/repo/src/A@server.luau",
						},
					},
				]
			);

			expect(diagnosticToJson(fixed).fixes).toEqual([
				{
					rename: {
						from: path.normalize("/repo/src/A@sever.luau"),
						to: path.normalize("/repo/src/A@server.luau"),
					},
				},
			]);
			expect(
				diagnosticToJson(
					warningDiagnostic("test.example", { resource: "/repo" }, "")
				)
			).not.toHaveProperty("fixes");
		});

		it("should give each related file as a native path with its message, and leave related out when there is none", () => {
			const grouped = warningDiagnostic(
				"test.example",
				{ resource: "/repo/default.rogen.json" },
				"1 name:",
				[],
				[
					{
						resource: "/repo/src/A@sever.luau",
						message: "did you mean?",
					},
				]
			);

			expect(diagnosticToJson(grouped).related).toEqual([
				{
					file: path.normalize("/repo/src/A@sever.luau"),
					message: "did you mean?",
				},
			]);
			expect(
				diagnosticToJson(
					warningDiagnostic("test.example", { resource: "/repo" }, "")
				)
			).not.toHaveProperty("related");
		});

		it("should leave fixes out of the rendered line", () => {
			const fixed = warningDiagnostic(
				"test.example",
				{ resource: "/repo/a.json" },
				"near miss.",
				[{ rename: { from: "/repo/a", to: "/repo/b" } }]
			);

			expect(renderDiagnostic(fixed)).toBe(
				`${path.normalize("/repo/a.json")} - warning: near miss. (test.example)`
			);
		});

		it("should anchor the url at the code in lower case, with the dot as a hyphen", () => {
			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
				code: "route.dotRoute",
				message: "",
				resource: "/repo/src",
			};

			expect(diagnosticToJson(diagnostic).url).toBe(
				`${DOCS_URL}/diagnostics#route-dotroute`
			);
		});
	});

	describe("diagnosticsAbout", () => {
		const own = warningDiagnostic(
			"x.own",
			{ resource: "/repo/src/A.luau" },
			"own"
		);
		const group = warningDiagnostic(
			"x.group",
			{ resource: "/repo/default.rogen.json" },
			"2 files:\n  src/A.luau\n  src/B.luau",
			[
				{
					rename: {
						from: "/repo/src/A.luau",
						to: "/repo/src/a.luau",
					},
				},
				{
					rename: {
						from: "/repo/src/B.luau",
						to: "/repo/src/b.luau",
					},
				},
			],
			[
				{ resource: "/repo/src/A.luau", message: "A is odd" },
				{ resource: "/repo/src/B.luau", message: "B is odd" },
			]
		);

		it("should keep a diagnostic whose resource is the path", () => {
			expect(diagnosticsAbout([own], "/repo/src/A.luau")).toEqual([own]);
			expect(diagnosticsAbout([own], "/repo/src/B.luau")).toEqual([]);
		});

		it("should narrow a grouped one to the entry that names the path, with its own fixes", () => {
			expect(diagnosticsAbout([group], "/repo/src/B.luau")).toMatchObject(
				[
					{
						code: "x.group",
						resource: "/repo/src/B.luau",
						message: "B is odd",
						fixes: [
							{
								rename: {
									from: "/repo/src/B.luau",
									to: "/repo/src/b.luau",
								},
							},
						],
					},
				]
			);
		});

		it("should say nothing of the config a group is filed under", () => {
			expect(
				diagnosticsAbout([group], "/repo/default.rogen.json")
			).toEqual([]);
		});
	});

	describe("diagnosticsReaching", () => {
		const about = (resource: string, code = "x.y") =>
			warningDiagnostic(code, { resource }, "odd");

		it("should keep one about the path, one inside it and one about a folder it lies in", () => {
			const file = about("/repo/src/F/A.luau", "x.file");
			const inside = about("/repo/src/F/Sever", "x.inside");
			const above = about("/repo/src/F", "x.above");

			expect(
				diagnosticsReaching(
					[file, inside, above],
					"/repo/src/F/A.luau"
				).map(({ code }) => code)
			).toEqual(["x.file", "x.above"]);
			expect(
				diagnosticsReaching([file, inside, above], "/repo/src/F").map(
					({ code }) => code
				)
			).toEqual(["x.file", "x.inside", "x.above"]);
		});

		it("should leave out one about a sibling, and one filed under a config", () => {
			expect(
				diagnosticsReaching(
					[
						about("/repo/src/F/B.luau"),
						about("/repo/src/Fx/A.luau"),
						about("/repo/default.rogen.json"),
					],
					"/repo/src/F/A.luau"
				)
			).toEqual([]);
		});

		it("should narrow a grouped one to the entries that reach the path", () => {
			const group = warningDiagnostic(
				"x.group",
				{ resource: "/repo/default.rogen.json" },
				"3 files",
				[],
				[
					{ resource: "/repo/src/F/A.luau", message: "A" },
					{ resource: "/repo/src/F/B.luau", message: "B" },
					{ resource: "/repo/src/G/C.luau", message: "C" },
				]
			);

			expect(
				diagnosticsReaching([group], "/repo/src/F").map(
					({ message }) => message
				)
			).toEqual(["A", "B"]);
		});
	});
});
