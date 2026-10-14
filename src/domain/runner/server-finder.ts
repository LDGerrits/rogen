import path from "path";
import { Result, err, ok } from "../../base/result.js";
import { firstLine } from "../../base/strings.js";
import {
	DiagnosticFix,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { SyncServer } from "./sync-server.js";
import { ServerExecutable } from "./rojo-runner.js";
import { ToolManifest } from "../toolchain/tool-manifest.js";
import { ToolchainService } from "../toolchain/toolchain-service.js";

/** A toolchain manager may download the tool before `--version` answers. */
const VERSION_TIMEOUT_MS = 60_000;

interface Candidate {
	readonly server: SyncServer;
	readonly command: string;
	readonly manifest?: ToolManifest;
}

interface PinnedCandidate extends Candidate {
	readonly manifest: ToolManifest;
}

const ARGON_REPOSITORY = "argon-rbx/argon";

export class ServerFinder {
	constructor(
		private readonly toolchainService: ToolchainService,
		private readonly processService: ProcessService
	) {}

	/** Toolchain files are looked for in `directory`, then in every folder above it. A failure without a toolchain file to point at is about `resource`. */
	async find(
		directory: string,
		resource: string,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, DiagnosticsError>> {
		const manifests = await this.toolchainService.readManifests(directory);
		const server = SyncServer.ROJO;
		let pinned: PinnedCandidate | undefined;
		for (const manifest of manifests) {
			const command = manifest.nameOf(server.repository);
			if (command) {
				pinned = { server, command, manifest };
				break;
			}
		}
		const candidate: Candidate = pinned ?? { server, command: server.id };

		const file = await this.processService.which(candidate.command);
		if (!file) {
			return err(
				new DiagnosticsError([
					pinned
						? this.notInstalled(pinned)
						: this.noServer(directory, manifests, resource),
				])
			);
		}

		const version = await this.versionOf(
			candidate,
			file,
			directory,
			manifests,
			resource,
			signal
		);
		if (version.isErr()) return version;
		return ok({ server, file, version: version.value });
	}

	private async versionOf(
		candidate: Candidate,
		file: string,
		directory: string,
		manifests: readonly ToolManifest[],
		resource: string,
		signal?: AbortSignal
	): Promise<Result<string, DiagnosticsError>> {
		const output = await this.processService.exec(file, ["--version"], {
			cwd: directory,
			timeout: VERSION_TIMEOUT_MS,
			signal,
		});
		const printed = output.isOk()
			? (firstLine(output.value.stderr) ?? firstLine(output.value.stdout))
			: firstLine(output.error.message);
		if (output.isOk() && output.value.code === 0) {
			const version = /\d+\.\d+\.\d+(?:[-+][\w.-]+)?/.exec(
				output.value.stdout
			);
			if (version) return ok(version[0]);
		}

		const { server, command, manifest } = candidate;
		const pin = manifest
			? undefined
			: this.pinFix(server, directory, manifests);
		return err(
			new DiagnosticsError([
				errorDiagnostic(
					"serve.serverFailed",
					{ resource: manifest?.file ?? resource },
					`'${command} --version' failed, so ${server.name} can't start${printed ? `: ${printed}${/[.!?]$/.test(printed) ? "" : "."}` : "."}${pin ? ` If ${server.name} isn't pinned yet, run '${pin.run.command}'.` : ""}`,
					pin ? [pin] : []
				),
			])
		);
	}

	private notInstalled({ server, command, manifest }: PinnedCandidate) {
		const { file } = manifest;
		return errorDiagnostic(
			"serve.notInstalled",
			{ resource: file },
			`${path.basename(file)} pins ${server.name} as ${command}, but it isn't installed. Run '${manifest.installCommand}'.`,
			[
				{
					run: {
						command: manifest.installCommand,
						cwd: path.dirname(file),
					},
				},
			]
		);
	}

	private noServer(
		directory: string,
		manifests: readonly ToolManifest[],
		resource: string
	) {
		const server = SyncServer.ROJO;
		const pin = this.pinFix(server, directory, manifests);
		const plugin = {
			run: { command: server.pluginCommand, cwd: directory },
		};
		const steps = pin
			? `Run '${pin.run.command}', then '${server.pluginCommand}' to install its Studio plugin.`
			: `Pin ${server.repository} in ${path.basename(manifests[0].file)}, install it, then run '${server.pluginCommand}' to install its Studio plugin.`;
		const argon = manifests.some((manifest) =>
			manifest.nameOf(ARGON_REPOSITORY)
		)
			? " Argon is pinned, but rogen serve only starts Rojo: run 'rogen watch' to keep the project files current, and 'argon serve' to serve them."
			: "";
		return errorDiagnostic(
			"serve.noServer",
			{ resource: manifests[0]?.file ?? resource },
			`No ${server.name} to serve with: none is pinned in a toolchain file here or above, or on the PATH. ${steps}${argon}`,
			pin ? [pin, plugin] : [plugin]
		);
	}

	private pinFix(
		server: SyncServer,
		directory: string,
		manifests: readonly ToolManifest[]
	): Extract<DiagnosticFix, { run: unknown }> | undefined {
		const [nearest] = manifests;
		const command = nearest
			? nearest.addCommand(server.repository)
			: `rokit add ${server.repository}`;
		return command === undefined
			? undefined
			: {
					run: {
						command,
						cwd: nearest ? path.dirname(nearest.file) : directory,
					},
				};
	}
}
