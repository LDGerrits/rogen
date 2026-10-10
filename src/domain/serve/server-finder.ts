import path from "path";
import { ancestors } from "../../base/path.js";
import { Result, err, ok } from "../../base/result.js";
import { firstLine, joinedWithOr } from "../../base/strings.js";
import {
	DiagnosticFix,
	errorDiagnostic,
} from "../../platform/diagnostics/diagnostic.js";
import { DiagnosticsError } from "../../platform/diagnostics/diagnostics-error.js";
import { FileReader } from "../../platform/fs/file-system-service.js";
import { ProcessService } from "../../platform/process/process-service.js";
import { SyncServer } from "./serve.js";
import { ServerExecutable } from "./serve-service.js";
import { ToolManifest } from "./tool-manifest.js";

/** How long `--version` may take; a toolchain manager may download the tool first. */
const VERSION_TIMEOUT_MS = 60_000;

interface Candidate {
	readonly server: SyncServer;
	/** The name it runs as. */
	readonly command: string;
	readonly manifest?: ToolManifest;
}

/** A candidate a toolchain file pins. */
interface PinnedCandidate extends Candidate {
	readonly manifest: ToolManifest;
}

/** Finds the sync server a project pins in its toolchain files, else the one on the PATH, so the version the project pins is the one that runs. */
export class ServerFinder {
	constructor(
		private readonly fileSystemService: FileReader,
		private readonly processService: ProcessService
	) {}

	/** `wanted` picks the server; without it Rojo goes before Argon. `directory` is where the server will run, and where toolchain files are looked for, then in every folder above it. A failure without a toolchain file to point at is about `resource`. */
	async find(
		directory: string,
		wanted: SyncServer | undefined,
		resource: string,
		signal?: AbortSignal
	): Promise<Result<ServerExecutable, DiagnosticsError>> {
		const manifests = await this.manifestsFor(directory);
		const servers = wanted ? [wanted] : SyncServer.ALL;
		const pinned = servers.flatMap((server): PinnedCandidate[] => {
			for (const manifest of manifests) {
				const command = manifest.nameOf(server.repository);
				if (command) return [{ server, command, manifest }];
			}
			return [];
		});
		const candidates =
			pinned.length > 0
				? pinned
				: servers.map((server) => ({ server, command: server.id }));

		const found: { candidate: Candidate; file: string }[] = [];
		for (const candidate of candidates) {
			const file = await this.processService.which(candidate.command);
			if (file) found.push({ candidate, file });
		}
		const [chosen, other] = found;
		if (!chosen) {
			return err(
				new DiagnosticsError([
					pinned.length > 0
						? this.notInstalled(pinned[0])
						: this.noServer(directory, manifests, wanted, resource),
				])
			);
		}

		const version = await this.versionOf(
			chosen.candidate,
			chosen.file,
			directory,
			manifests,
			resource,
			signal
		);
		if (version.isErr()) return version;
		return ok({
			server: chosen.candidate.server,
			file: chosen.file,
			version: version.value,
			passedOver: pinned.length > 0 ? other?.candidate.server : undefined,
		});
	}

	/** The toolchain files of `directory` and every folder above it, the nearest first. */
	private async manifestsFor(directory: string): Promise<ToolManifest[]> {
		const manifests: ToolManifest[] = [];
		for (const dir of [directory, ...ancestors(directory)]) {
			for (const fileName of ToolManifest.FILE_NAMES) {
				const file = path.join(dir, fileName);
				if (!(await this.fileSystemService.exists(file))) continue;
				try {
					const manifest = ToolManifest.parse(
						file,
						await this.fileSystemService.readFile(file)
					);
					if (manifest) manifests.push(manifest);
				} catch {
					// An unreadable toolchain file pins nothing; the manager reports it when it runs.
				}
			}
		}
		return manifests;
	}

	/** Runs `--version`, which proves the server starts, through its toolchain manager when one pins it. */
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
		wanted: SyncServer | undefined,
		resource: string
	) {
		const server = wanted ?? SyncServer.ROJO;
		const names = wanted
			? wanted.name
			: joinedWithOr(SyncServer.ALL.map(({ name }) => name));
		const pin = this.pinFix(server, directory, manifests);
		const plugin = {
			run: { command: server.pluginCommand, cwd: directory },
		};
		const steps = pin
			? `Run '${pin.run.command}', then '${server.pluginCommand}' to install its Studio plugin.`
			: `Pin ${server.repository} in ${path.basename(manifests[0].file)}, install it, then run '${server.pluginCommand}' to install its Studio plugin.`;
		return errorDiagnostic(
			"serve.noServer",
			{ resource: manifests[0]?.file ?? resource },
			`No ${names} to serve with: none is pinned in a toolchain file here or above, or on the PATH. ${steps}`,
			pin ? [pin, plugin] : [plugin]
		);
	}

	/** The command that pins `server` in the nearest toolchain file, or with Rokit when there is none. */
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
