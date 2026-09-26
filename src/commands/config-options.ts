import { OptionDescriptor } from "../platform/environment/args.js";

/** The flags that override, or pick, the configs a command reads. */
export const ConfigOptions: readonly OptionDescriptor[] = [
	{
		name: "config",
		short: "c",
		type: "string",
		multiple: true,
		description: "An explicit config path.",
	},
	{
		name: "out-file",
		short: "o",
		type: "string",
		description: "Overrides outFile.",
	},
	{
		name: "sync-dir",
		short: "s",
		type: "string",
		description: "Overrides syncDir.",
	},
	{
		name: "template",
		type: "string",
		description: "Overrides template.",
	},
	{
		name: "tag",
		short: "t",
		type: "string",
		multiple: true,
		description: "Turns a tag on.",
	},
	{
		name: "no-tag",
		short: "T",
		type: "string",
		multiple: true,
		description: "Turns a tag off.",
	},
];
