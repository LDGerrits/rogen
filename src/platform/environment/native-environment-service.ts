import os from "os";
import path from "path";
import { LogLevel } from "../log/log-service.js";
import { EnvironmentService } from "./environment-service.js";

type Variables = Readonly<Record<string, string | undefined>>;

const GENERIC_VARIABLES = ["CI", "AGENT", "AI_AGENT"];

const HARNESS_VARIABLES = [
	"CLAUDECODE",
	"CODEX_SANDBOX",
	"CODEX_THREAD_ID",
	"CURSOR_AGENT",
	"GEMINI_CLI",
	"COPILOT_AGENT",
	"OPENCODE",
	"CLINE_ACTIVE",
];

const isSet = (value: string | undefined) =>
	value !== undefined && value !== "";

function isOn(value: string | undefined): boolean {
	const lowered = value?.toLowerCase();
	return isSet(lowered) && lowered !== "0" && lowered !== "false";
}

function isAutomated(env: Variables): boolean {
	return (
		GENERIC_VARIABLES.some((name) => isOn(env[name])) ||
		HARNESS_VARIABLES.some((name) => isSet(env[name]))
	);
}

function userCacheDir(
	env: Variables,
	platform: NodeJS.Platform,
	userHome: string
): string {
	if (isSet(env.XDG_CACHE_HOME)) return env.XDG_CACHE_HOME!;
	if (platform === "darwin") return path.join(userHome, "Library", "Caches");
	if (platform === "win32")
		return env.LOCALAPPDATA || path.join(userHome, "AppData", "Local");
	return path.join(userHome, ".cache");
}

interface ProcessContext {
	readonly env: Variables;
	readonly isTerminal: boolean;
	readonly userHome: string;
	readonly tmpDir: string;
	readonly pid: number;
	readonly platform: NodeJS.Platform;
}

const nativeProcess = (): ProcessContext => ({
	env: process.env,
	isTerminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
	userHome: os.homedir(),
	tmpDir: os.tmpdir(),
	pid: process.pid,
	platform: process.platform,
});

interface OutputFlags {
	readonly json?: boolean;
	/** One `true` for each `-v` given. */
	readonly verbose?: readonly boolean[];
	readonly quiet?: boolean;
	readonly color?: string;
}

export class NativeEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	readonly logLevel: LogLevel;
	readonly isInteractive: boolean;
	readonly isPlain: boolean;
	readonly userHome: string;
	readonly tmpDir: string;
	readonly cacheDir: string;
	readonly checksForUpdates: boolean;
	readonly annotationsIn?: string;
	readonly pid: number;

	constructor(
		{ json, verbose = [], quiet, color }: OutputFlags,
		readonly cwd: string,
		{
			env,
			isTerminal,
			userHome,
			tmpDir,
			pid,
			platform,
		}: ProcessContext = nativeProcess()
	) {
		this.userHome = userHome;
		this.tmpDir = tmpDir;
		this.cacheDir = userCacheDir(env, platform, userHome);
		if (env.GITHUB_ACTIONS === "true" && json !== true)
			this.annotationsIn = env.GITHUB_WORKSPACE || cwd;
		this.pid = pid;
		this.logLevel = quiet
			? LogLevel.Error
			: verbose.length > 1
				? LogLevel.Trace
				: verbose.length === 1
					? LogLevel.Debug
					: LogLevel.Info;
		this.isInteractive =
			isTerminal && env.TERM !== "dumb" && !isAutomated(env);
		this.isPlain =
			json === true ||
			color === "never" ||
			(color !== "always" &&
				(!this.isInteractive || isSet(env.NO_COLOR)));
		this.checksForUpdates =
			this.isInteractive &&
			json !== true &&
			!quiet &&
			!isOn(env.ROGEN_NO_UPDATE_CHECK) &&
			!isSet(env.NO_UPDATE_NOTIFIER);
	}
}
