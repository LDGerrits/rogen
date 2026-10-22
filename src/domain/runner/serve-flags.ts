import { UsageError } from "../../base/errors.js";
import { Result, err, ok } from "../../base/result.js";
import { RojoVersion } from "./rojo-version.js";

const HOST_FLAGS = ["--address"];

const PORT_FLAGS = ["--port"];

/** Its flags that older releases reject, with the release that added each. */
const FLAGS_SINCE: Readonly<Record<string, RojoVersion>> = {
	"--allowed-hosts": RojoVersion.of("7.7.0"),
};

/** The value of the last of `flags` in `args`, written `--flag value` or `--flag=value`. */
function flagValue(
	args: readonly string[],
	flags: readonly string[]
): string | undefined {
	let value: string | undefined;
	args.forEach((arg, index) => {
		for (const flag of flags) {
			if (arg === flag) value = args[index + 1];
			else if (arg.startsWith(`${flag}=`))
				value = arg.slice(flag.length + 1);
		}
	});
	return value;
}

/** What `rogen serve` reads from the flags it passes to Rojo. */
export class ServeFlags {
	/** The first of `serverArgs` that `version` rejects, with the release that added it. */
	static tooNewIn(
		serverArgs: readonly string[],
		version: string
	): { readonly flag: string; readonly since: RojoVersion } | undefined {
		const found = RojoVersion.parse(version);
		if (!found) return undefined;
		for (const [flag, since] of Object.entries(FLAGS_SINCE)) {
			if (
				found.isBefore(since) &&
				serverArgs.some(
					(arg) => arg === flag || arg.startsWith(`${flag}=`)
				)
			)
				return { flag, since };
		}
		return undefined;
	}

	/** `serverArgs` without its port flags and their values. */
	static withoutPort(serverArgs: readonly string[]): string[] {
		const kept: string[] = [];
		for (let index = 0; index < serverArgs.length; index++) {
			const arg = serverArgs[index];
			if (PORT_FLAGS.includes(arg)) index++;
			else if (!PORT_FLAGS.some((flag) => arg.startsWith(`${flag}=`)))
				kept.push(arg);
		}
		return kept;
	}

	static hostIn(serverArgs: readonly string[]): string | undefined {
		return flagValue(serverArgs, HOST_FLAGS);
	}

	static portIn(
		serverArgs: readonly string[]
	): Result<number | undefined, UsageError> {
		const value = flagValue(serverArgs, PORT_FLAGS);
		if (value === undefined) return ok(undefined);
		const port = /^\d+$/.test(value) ? Number(value) : NaN;
		return port > 0 && port < 65536
			? ok(port)
			: err(new UsageError("--port takes a number from 1 to 65535."));
	}
}
