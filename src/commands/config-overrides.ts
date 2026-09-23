import { OptionDescriptor } from "../platform/environment/args.js";

export const CONFIG_OVERRIDE_OPTIONS: readonly OptionDescriptor[] = [
	{
		name: "source",
		short: "s",
		type: "string",
		multiple: true,
		description: "Override the source directories.",
	},
	{
		name: "env",
		short: "e",
		type: "string",
		multiple: true,
		description: "Set the build environment.",
	},
	{
		name: "build",
		type: "string",
		description: "Override the build command.",
	},
	{
		name: "output",
		type: "string",
		description: "Override the output directory.",
	},
	{
		name: "mode",
		type: "string",
		multiple: true,
		description: "Limit the build to these toolchains.",
	},
];
