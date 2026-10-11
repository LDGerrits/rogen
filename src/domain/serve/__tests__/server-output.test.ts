import { jest } from "@jest/globals";
import { ServerMessage, SyncServer } from "../serve.js";
import { ServerOutput } from "../server-output.js";

describe("ServerOutput", () => {
	let output: ServerOutput;
	let said: ServerMessage[];
	let dropped: string[];

	const write = (text: string) => {
		const lines = text.split(/\r?\n/);
		if (lines.at(-1) === "") lines.pop();
		for (const line of lines) output.readLine(line);
	};

	const reading = (server: SyncServer) => {
		output = new ServerOutput(server);
		said = [];
		dropped = [];
		output.onDidMessage((message) =>
			message.severity === "debug"
				? dropped.push(message.text)
				: said.push(message)
		);
		return output;
	};

	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		output[Symbol.dispose]();
		jest.useRealTimers();
	});

	describe("with Rojo", () => {
		beforeEach(() => {
			reading(SyncServer.ROJO);
		});

		it("should drop the banner", () => {
			write(
				[
					"Rojo server listening:",
					"  Address: \u001b[0m\u001b[1m\u001b[32mlocalhost",
					"\u001b[0m  Port:    \u001b[0m\u001b[1m\u001b[32m34872",
					"",
					"\u001b[0mVisit \u001b[0m\u001b[1m\u001b[32mhttp://localhost:34872/\u001b[0m in your browser for more information.",
					"",
				].join("\n")
			);
			output.end();

			expect(said).toEqual([]);
			expect(dropped).toEqual([
				"Rojo server listening:",
				"Address: localhost",
				"Port:    34872",
				"Visit http://localhost:34872/ in your browser for more information.",
			]);
		});

		it("should say a paragraph the server writes in capitals as one warning, up to the blank line", () => {
			write(
				[
					"\u001b[0m\u001b[1m\u001b[33mWARNING: This server is bound to 0.0.0.0, which is reachable.",
					"The serve API is unauthenticated, so anyone who can reach it can",
					"modify your project's source.",
					"\u001b[0m",
					"\u001b[0mVisit \u001b[0mhttp://0.0.0.0:34999/ in your browser.",
					"",
				].join("\n")
			);
			output.end();

			expect(said).toEqual([
				{
					severity: "warning",
					text: "This server is bound to 0.0.0.0, which is reachable. The serve API is unauthenticated, so anyone who can reach it can modify your project's source.",
				},
			]);
			expect(dropped).toEqual([
				"Visit http://0.0.0.0:34999/ in your browser.",
			]);
		});

		it("should join a record and its cause chain into one message", () => {
			write(
				[
					"[ERROR librojo::change_processor] Snapshot error: File was not a valid Rojo project: /repo/default.project.json",
					"        ",
					"        Caused by:",
					"            0: Error parsing Rojo project in path /repo/default.project.json",
					"            1: Failed to parse JSONC",
					"",
				].join("\n")
			);
			jest.advanceTimersByTime(100);

			expect(said).toEqual([
				{
					severity: "error",
					text: "Snapshot error: File was not a valid Rojo project: /repo/default.project.json: Error parsing Rojo project in path /repo/default.project.json: Failed to parse JSONC",
				},
			]);
		});

		it("should wait for the rest of a record that arrives in pieces", () => {
			write(
				"[WARN  librojo::snapshot] Unknown file: /repo/a.xyz\n        \n"
			);
			jest.advanceTimersByTime(10);
			write("        Caused by:\n            no handler\n");
			jest.advanceTimersByTime(100);

			expect(said).toEqual([
				{
					severity: "warning",
					text: "Unknown file: /repo/a.xyz: no handler",
				},
			]);
		});

		it("should drop its info and debug logs", () => {
			write("[INFO  librojo::serve] Listening\n[DEBUG librojo] Tick\n");
			output.end();

			expect(said).toEqual([]);
			expect(dropped).toEqual(["Listening", "Tick"]);
		});

		it("should say the same message once while it repeats", () => {
			const twice =
				"[ERROR librojo] Bad model\n[ERROR librojo] Bad model\n";
			write(twice);
			jest.advanceTimersByTime(100);
			jest.advanceTimersByTime(5_000);
			write("[ERROR librojo] Bad model\n");
			output.end();

			expect(said).toEqual([
				{ severity: "error", text: "Bad model" },
				{ severity: "error", text: "Bad model" },
			]);
		});

		it("should keep the lines it doesn't recognise, and a command line error", () => {
			write(
				[
					"error: unexpected argument '--nope' found",
					"",
					"Usage: rojo serve [OPTIONS] [PROJECT]",
					"thread 'main' panicked at src/serve.rs:10:5:",
					"note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace",
				].join("\n")
			);
			output.end();

			expect(said).toEqual([
				{
					severity: "error",
					text: "unexpected argument '--nope' found",
				},
				{
					severity: "info",
					text: "Usage: rojo serve [OPTIONS] [PROJECT]",
				},
				{
					severity: "info",
					text: "thread 'main' panicked at src/serve.rs:10:5:",
				},
			]);
		});
	});

	describe("with Argon", () => {
		beforeEach(() => {
			reading(SyncServer.ARGON);
		});

		it("should read a record in capitals as one line of its log, not a paragraph", () => {
			write(["ERROR: it broke", "Listening on 34872", ""].join("\n"));
			output.end();

			expect(said).toEqual([
				{ severity: "error", text: "it broke" },
				{ severity: "info", text: "Listening on 34872" },
			]);
		});

		it("should drop its info logs and what Rogen's probes and writes make it say", () => {
			write(
				[
					"INFO: Serving on: http://localhost:8000, project: /repo/default.project.json",
					"ERROR: stream error: request parse error: invalid Header provided [actix_http::h1::dispatcher:1257]",
					"ERROR: Warning! Top level project file was deleted. This might cause unexpected behavior. Skipping processing of changes!",
					"",
				].join("\n")
			);
			output.end();

			expect(said).toEqual([]);
		});

		it("should drop the debug detail it appends to an error", () => {
			write(
				[
					'ERROR: Failed to process changes: Failed to read JsonModel at /repo/src/Bad.model.json: key must be a string at line 1 column 3, source: Project("ReplicatedStorage", "/repo/default.project.json", ProjectNode { class_name: None }) [argon::core::processor::read:44]',
					"ERROR: Failed to reload project: Failed to parse project at /repo/default.project.json: expected ident at line 1 column 2 [argon::core::processor:167]",
					"",
				].join("\n")
			);
			output.end();

			expect(said).toEqual([
				{
					severity: "error",
					text: "Failed to process changes: Failed to read JsonModel at /repo/src/Bad.model.json: key must be a string at line 1 column 3",
				},
				{
					severity: "error",
					text: "Failed to reload project: Failed to parse project at /repo/default.project.json: expected ident at line 1 column 2",
				},
			]);
		});

		it("should show a warning as one", () => {
			write("WARN: Something is off\n");
			output.end();

			expect(said).toEqual([
				{ severity: "warning", text: "Something is off" },
			]);
		});
	});
});
