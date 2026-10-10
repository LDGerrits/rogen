import fs from "fs";
import path from "path";
import {
	DiagnosticSeverity,
	diagnosticToJson,
} from "../platform/diagnostics/diagnostic.js";
import { DOCS_URL } from "../platform/product/product-service.js";

const SRC = path.resolve(import.meta.dirname, "..");
const PAGE = path.resolve(SRC, "../docs/content/docs/v2/diagnostics.mdx");

const CALL =
	/(?:errorDiagnostic|warningDiagnostic|\.error|\.warning|\.misspelt|\.grouped)\(\s*"([A-Za-z.]+)"/g;
const CODE = /^[a-z]+\.[a-z][A-Za-z]+$/;
const READER = "platform/jsonc/jsonc-document-reader.ts";
const PREFIX = /codePrefix: "([a-z]+)"/g;
const SECTION = /^### `([^`]+)` \[#([a-z-]+)\]$/gm;

function sourceFiles(dir: string): string[] {
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.name !== "__tests__")
		.flatMap((entry) => {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory()) return sourceFiles(file);
			return entry.name.endsWith(".ts") ? [file] : [];
		});
}

function emittedCodes(): string[] {
	const codes = new Set<string>();
	const readerCodes: string[] = [];
	const prefixes: string[] = [];
	for (const file of sourceFiles(SRC)) {
		const text = fs.readFileSync(file, "utf8");
		const called = [...text.matchAll(CALL)].map(([, code]) => code);
		if (path.relative(SRC, file).split(path.sep).join("/") === READER)
			readerCodes.push(...called);
		else
			for (const code of called.filter((c) => CODE.test(c)))
				codes.add(code);
		prefixes.push(
			...[...text.matchAll(PREFIX)].map(([, prefix]) => prefix)
		);
	}
	for (const prefix of prefixes)
		for (const code of readerCodes) codes.add(`${prefix}.${code}`);
	return [...codes].sort();
}

const urlOf = (code: string) =>
	diagnosticToJson({
		resource: "/repo/x",
		severity: DiagnosticSeverity.Warning,
		code,
		message: "",
	}).url;

describe("the diagnostics page", () => {
	const page = fs.readFileSync(PAGE, "utf8");
	const sections = new Map(
		[...page.matchAll(SECTION)].map(([, code, anchor]) => [code, anchor])
	);
	const codes = emittedCodes();

	it("should find the codes the source emits", () => {
		expect(codes).toEqual(
			expect.arrayContaining(["config.unknownField", "route.strayAt"])
		);
	});

	it("should have a section for every code the source emits", () => {
		expect(codes.filter((code) => !sections.has(code))).toEqual([]);
	});

	it("should have no section for a code the source doesn't emit", () => {
		expect(
			[...sections.keys()].filter((code) => !codes.includes(code))
		).toEqual([]);
	});

	it.each(codes)("should anchor %s where its url points", (code) => {
		expect(urlOf(code)).toBe(
			`${DOCS_URL}/diagnostics#${sections.get(code)}`
		);
	});
});
