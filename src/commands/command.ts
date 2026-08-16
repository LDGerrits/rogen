import { CliArgs } from "./args.js";
import { Result, err } from "../base/result.js";

export interface Command {
	execute(args: CliArgs): Promise<Result<void, Error>> | Result<void, Error>;
}

export type CommandFactory = () => Command;

export class CommandRegistry {
	private readonly commands = new Map<string, CommandFactory>();

	register(name: string, factory: CommandFactory): void {
		this.commands.set(name.toLowerCase(), factory);
	}

	async execute(name: string, args: CliArgs): Promise<Result<void, Error>> {
		const factory = this.commands.get(name.toLowerCase());

		if (!factory) {
			return err(
				new Error(
					`Unknown command "${name}". Run 'rogen --help' to see available commands.`
				)
			);
		}

		const command = factory();
		return await command.execute(args);
	}
}
