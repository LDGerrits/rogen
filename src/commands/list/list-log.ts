import { relativeTo, toNative } from "../../base/path.js";
import { plural } from "../../base/strings.js";
import { unescapedGlob } from "../../base/glob.js";
import { ResolvedConfig, configLabel } from "../../domain/config/config.js";
import { ConfigEntry } from "../../domain/config/config-service.js";
import { LogService } from "../../platform/log/log-service.js";
import { BuildLog } from "../build/build-log.js";
import { diagnosticToJson } from "../../platform/diagnostics/diagnostic-json.js";

const listed = (values: readonly string[]): string =>
	values.length > 0 ? values.join(", ") : "(none)";

/** Every variant the config declares, with its state, in the order declared. */
const variantLines = ({ variants }: ResolvedConfig): string[] =>
	Object.entries(variants).map(
		([variant, on]) => `${variant} ${on ? "on" : "off"}`
	);

/** The resolved routes as `key -> target`, in the config's order. */
const routeLines = ({ routes }: ResolvedConfig): string[] =>
	[...routes].map(([key, target]) => `${key} -> ${target.toString()}`);

/** The configs a run read: as lines relative to the working dir, or as one JSON document with an entry per config. */
export class ListLog {
	constructor(
		private readonly logService: LogService,
		private readonly cwd: string
	) {}

	/** The run's result when some configs are broken; none when every one loads. */
	static failure(entries: readonly ConfigEntry[]): Error | undefined {
		const broken = entries.filter(
			({ status }) => status === "broken"
		).length;
		if (broken === 0) return undefined;
		const verb = broken === 1 ? "has" : "have";
		return new Error(
			broken === entries.length
				? `${plural(broken, "config")} ${verb} errors.`
				: `${broken} of ${entries.length} configs ${verb} errors.`
		);
	}

	/** The intro, one block per config (its file, what it extends, then its values or its errors), and the closing line when every config loads. `home` is the folder the configs are read from. */
	print(entries: readonly ConfigEntry[], home?: string): void {
		const { logService } = this;
		new BuildLog(logService, this.cwd).begin("list", [], home);
		const relative = (file: string) => relativeTo(this.cwd, file);
		const printed: { label: string; routes: readonly string[] }[] = [];
		for (const entry of entries) {
			const extended =
				entry.parents.length > 0
					? [`extends: ${entry.parents.map(relative).join(" -> ")}`]
					: [];
			if (entry.status === "broken") {
				logService.section(
					relative(entry.file),
					extended.join("\n") || undefined
				);
				for (const error of entry.errors) logService.diagnostic(error);
				continue;
			}
			const { config } = entry;
			const label = configLabel(entry.file);
			const routes = routeLines(config);
			const sameAs = printed.find(
				(other) =>
					other.routes.length === routes.length &&
					other.routes.every((line, index) => line === routes[index])
			);
			printed.push({ label, routes });
			logService.section(
				relative(entry.file),
				[
					...extended,
					`root dirs: ${listed(config.rootDirs.map(relative))}`,
					sameAs
						? `routes: same as ${sameAs.label}`
						: `routes:${routes.map((line) => `\n  ${line}`).join("")}`,
					...(config.template
						? [
								`template: ${[config.template.file, ...[...config.template.bases].reverse()].map(relative).join(", over ")}`,
							]
						: []),
					`sync dir: ${listed(config.syncDir ? [relative(config.syncDir)] : [])}`,
					`project file: ${relative(config.outFile)}`,
					`variants: ${listed(variantLines(config))}`,
					...(config.conflicts.length > 0
						? [
								`conflicts: ${config.conflicts.map((group) => group.join(" | ")).join(", ")}`,
							]
						: []),
					...(config.mode !== undefined
						? [
								`mode: ${config.mode}`,
								`modes: ${config.modes.join(", ")}`,
							]
						: []),
				].join("\n")
			);
		}
		if (ListLog.failure(entries) === undefined)
			logService.outro(`${plural(entries.length, "config")}.`);
	}

	json(entries: readonly ConfigEntry[]): Record<string, unknown> {
		return {
			configs: entries.map((entry) => ({
				config: configLabel(entry.file),
				file: toNative(entry.file),
				status: entry.status,
				extends: entry.parents.map((file) => toNative(file)),
				...(entry.status === "valid"
					? describeConfig(entry.config)
					: {}),
				diagnostics:
					entry.status === "broken"
						? entry.errors.map(diagnosticToJson)
						: [],
			})),
		};
	}
}

function describeConfig(config: ResolvedConfig): Record<string, unknown> {
	return {
		projectName: config.name,
		rootDirs: config.rootDirs.map((file) => toNative(file)),
		commonRoot: config.commonRoot ? toNative(config.commonRoot) : null,
		routes: Object.fromEntries(
			[...config.routes].map(([key, target]) => [key, target.toString()])
		),
		variants: config.variants,
		conflicts: config.conflicts,
		mode: config.mode ?? null,
		modes: config.modes,
		exclude: config.exclude.map(unescapedGlob),
		template: config.template ? toNative(config.template.file) : null,
		templates: config.template
			? [...config.template.bases, config.template.file].map((file) =>
					toNative(file)
				)
			: [],
		syncDir: config.syncDir ? toNative(config.syncDir) : null,
		outFile: toNative(config.outFile),
	};
}
