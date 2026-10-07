import { LogLevel } from "../log/log-service.js";
import { EnvironmentService } from "./environment-service.js";

type Variables = Readonly<Record<string, string | undefined>>;

/** Set by CI services and by agents in general; `0` and `false` turn them off. */
const GENERIC_VARIABLES = ["CI", "AGENT", "AI_AGENT"];

/** Set by a coding agent's harness for the commands it runs, and never in a person's own terminal. */
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

/** Whether `env` says an agent or CI, not a person, runs the process. */
function isAutomated(env: Variables): boolean {
	return (
		GENERIC_VARIABLES.some((name) => {
			const value = env[name]?.toLowerCase();
			return isSet(value) && value !== "0" && value !== "false";
		}) || HARNESS_VARIABLES.some((name) => isSet(env[name]))
	);
}

/** The process Rogen runs in: its variables, and whether stdin and stdout are both terminals. */
export interface ProcessContext {
	readonly env: Variables;
	readonly isTerminal: boolean;
}

const nativeProcess = (): ProcessContext => ({
	env: process.env,
	isTerminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
});

/** The flags that say how a run prints, read even from a line that fails to parse. */
export interface OutputFlags {
	readonly json?: boolean;
	readonly verbose?: boolean;
	readonly quiet?: boolean;
}

export class NativeEnvironmentService implements EnvironmentService {
	declare readonly _serviceBrand: undefined;

	readonly logLevel: LogLevel;
	readonly isInteractive: boolean;
	readonly isPlain: boolean;

	constructor(
		{ json, verbose, quiet }: OutputFlags,
		readonly cwd: string,
		{ env, isTerminal }: ProcessContext = nativeProcess()
	) {
		this.logLevel = quiet
			? LogLevel.Error
			: verbose
				? LogLevel.Debug
				: LogLevel.Info;
		this.isInteractive =
			isTerminal && env.TERM !== "dumb" && !isAutomated(env);
		this.isPlain =
			json === true || !this.isInteractive || isSet(env.NO_COLOR);
	}
}
