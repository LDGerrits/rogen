"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { IconType } from "react-icons";
import {
	FaFolderOpen,
	FaFileCode,
	FaFolder,
	FaBox,
	FaServer,
	FaFileAlt,
	FaTerminal,
	FaUser,
} from "react-icons/fa";
import { SiRoblox } from "react-icons/si";

type ViewState = "folders" | "at" | "markers";

interface Row {
	readonly name: string;
	readonly level: number;
	readonly kind:
		| "root"
		| "feature"
		| "routing"
		| "script"
		| "marker"
		| "replicated"
		| "server"
		| "player"
		| "folder"
		| "instance";
	readonly mt?: boolean;
}

const rowStyles: Record<
	Row["kind"],
	{ icon: IconType; iconClass: string; textClass?: string; dim?: boolean }
> = {
	root: { icon: FaFolder, iconClass: "text-gray-600" },
	feature: {
		icon: FaFolderOpen,
		iconClass: "text-white",
		textClass: "text-white font-medium",
	},
	routing: { icon: FaFolder, iconClass: "text-gray-500", dim: true },
	script: { icon: FaFileCode, iconClass: "text-white" },
	marker: { icon: FaFileAlt, iconClass: "text-gray-500", dim: true },
	replicated: { icon: FaBox, iconClass: "text-gray-600" },
	server: { icon: FaServer, iconClass: "text-gray-600" },
	player: { icon: FaUser, iconClass: "text-gray-600" },
	folder: {
		icon: FaFolder,
		iconClass: "text-white",
		textClass: "text-white font-medium",
	},
	instance: { icon: FaFileAlt, iconClass: "text-gray-400" },
};

function studioTree(
	feature: string,
	shared: string[],
	server: string[],
	client: string[]
): Row[] {
	const rows: Row[] = [];
	if (shared.length > 0) {
		rows.push(
			{ name: "ReplicatedStorage", level: 0, kind: "replicated" },
			{ name: "Shared", level: 1, kind: "folder" },
			{ name: feature, level: 2, kind: "folder" },
			...shared.map((name): Row => ({ name, level: 3, kind: "instance" }))
		);
	}
	if (server.length > 0) {
		rows.push(
			{
				name: "ServerScriptService",
				level: 0,
				kind: "server",
				mt: rows.length > 0,
			},
			{ name: feature, level: 1, kind: "folder" },
			...server.map((name): Row => ({ name, level: 2, kind: "instance" }))
		);
	}
	if (client.length > 0) {
		rows.push(
			{
				name: "StarterPlayer",
				level: 0,
				kind: "player",
				mt: rows.length > 0,
			},
			{ name: "StarterPlayerScripts", level: 1, kind: "player" },
			{ name: feature, level: 2, kind: "folder" },
			...client.map((name): Row => ({ name, level: 3, kind: "instance" }))
		);
	}
	return rows;
}

const CONFIG = `{
  "name": "Game",
  "routes": {
    "Server": "ServerScriptService",
    "Client": "StarterPlayer/StarterPlayerScripts",
    "Shared": "ReplicatedStorage/Shared",
    "*": "ReplicatedStorage/Shared"
  },
  "tree": { "$className": "DataModel" }
}`;

const views: Record<
	ViewState,
	{ label: string; desc: string; disk: Row[]; studio: Row[] }
> = {
	folders: {
		label: "Routing Folders",
		desc: "Name a folder after a route, and everything inside goes to its target. The folder itself disappears.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Inventory", level: 1, kind: "feature" },
			{ name: "Client", level: 2, kind: "routing" },
			{ name: "InventoryController.luau", level: 3, kind: "script" },
			{ name: "Server", level: 2, kind: "routing" },
			{ name: "InventoryService.luau", level: 3, kind: "script" },
			{ name: "Shared", level: 2, kind: "routing" },
			{ name: "InventoryTypes.luau", level: 3, kind: "script" },
			{ name: "InventoryConfig.luau", level: 2, kind: "script" },
		],
		studio: studioTree(
			"Inventory",
			["InventoryConfig", "InventoryTypes"],
			["InventoryService"],
			["InventoryController"]
		),
	},
	at: {
		label: "The @ Sign",
		desc: "Add @ and a route to a file's name to send just that file. A module stays a module.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Combat", level: 1, kind: "feature" },
			{ name: "CombatController@Client.luau", level: 2, kind: "script" },
			{ name: "CombatService@Server.luau", level: 2, kind: "script" },
			{ name: "CombatTypes.luau", level: 2, kind: "script" },
		],
		studio: studioTree(
			"Combat",
			["CombatTypes"],
			["CombatService"],
			["CombatController"]
		),
	},
	markers: {
		label: "Marker Files",
		desc: "Add a file named @ and a route, such as @Server, to a folder, and the whole folder goes there under its own name.",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "AntiCheat", level: 1, kind: "feature" },
			{ name: "@Server", level: 2, kind: "marker" },
			{ name: "AntiCheatService.luau", level: 2, kind: "script" },
			{ name: "Monitor.luau", level: 2, kind: "script" },
		],
		studio: studioTree(
			"AntiCheat",
			[],
			["AntiCheatService", "Monitor"],
			[]
		),
	},
};

function Tree({ rows }: { rows: Row[] }) {
	return (
		<>
			{rows.map((row, i) => {
				const style = rowStyles[row.kind];
				const Icon = style.icon;
				return (
					<div
						key={i}
						className={`flex items-center gap-2 ${style.dim ? "opacity-50" : ""} ${row.mt ? "mt-3" : ""}`}
						style={{ marginLeft: `${row.level * 16}px` }}
					>
						<Icon className={style.iconClass} />{" "}
						<span className={style.textClass}>{row.name}</span>
					</div>
				);
			})}
		</>
	);
}

function Panel({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex-1 bg-[#050505] rounded-xl border border-white/10 overflow-hidden z-10 flex flex-col shadow-2xl">
			<div className="bg-[#0a0a0a] px-4 py-3 flex items-center gap-3 border-b border-white/10">
				{icon}
				<span className="text-xs font-mono text-gray-400 tracking-wide">
					{title}
				</span>
			</div>
			{children}
		</div>
	);
}

export function Routing() {
	const [activeView, setActiveView] = useState<ViewState>("folders");
	const view = views[activeView];

	return (
		<section id="routing" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 left-30 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-start text-left mb-16">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						How routing works
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						Declare your routes in{" "}
						<code className="text-gray-300">
							default.rogen.json
						</code>
						, then name a folder or a file after one.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 text-left">
					<Panel
						icon={<FaFileAlt className="text-gray-500 text-sm" />}
						title="default.rogen.json"
					>
						<pre className="p-6 font-mono text-sm leading-7 text-gray-300 overflow-x-auto">
							{CONFIG}
						</pre>
						<p className="px-6 pb-6 text-sm text-gray-500">
							<code className="text-gray-300">*</code> takes every
							file that no other route matches.
						</p>
					</Panel>

					<div className="flex flex-col gap-3">
						{(Object.keys(views) as ViewState[]).map((id) => (
							<button
								key={id}
								onClick={() => setActiveView(id)}
								className={`flex flex-col items-start text-left p-6 rounded-xl border transition-all duration-200 ${
									activeView === id
										? "bg-white/5 border-white/30"
										: "bg-[#0a0a0a]/60 border-white/10 hover:border-white/20"
								}`}
							>
								<span className="text-base font-semibold text-white mb-1">
									{views[id].label}
								</span>
								<span className="text-sm text-gray-400 leading-relaxed">
									{views[id].desc}
								</span>
							</button>
						))}
					</div>
				</div>

				<div className="w-full flex flex-col md:flex-row items-stretch justify-start gap-4 relative text-left">
					<Panel
						icon={<FaTerminal className="text-gray-500 text-sm" />}
						title="FILE SYSTEM"
					>
						<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto min-h-80">
							<Tree rows={view.disk} />
						</div>
					</Panel>

					<div className="flex items-center justify-center z-20 py-4 md:py-0 px-4 md:px-6">
						<svg
							className="text-gray-500 md:rotate-0 rotate-90"
							fill="none"
							height="32"
							shapeRendering="geometricPrecision"
							stroke="currentColor"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="1"
							viewBox="0 0 24 24"
							width="32"
						>
							<path d="M5 12h14"></path>
							<path d="M12 5l7 7-7 7"></path>
						</svg>
					</div>

					<Panel
						icon={<SiRoblox className="text-gray-400 text-sm" />}
						title="ROBLOX STUDIO"
					>
						<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto min-h-80">
							<Tree rows={view.studio} />
						</div>
					</Panel>
				</div>

				<Link
					href="/docs/v2/core-concepts/routing"
					className="mt-10 text-gray-400 hover:text-white transition-colors text-sm font-medium inline-flex items-center gap-1"
				>
					Read how routing works <span className="font-serif">→</span>
				</Link>
			</div>
		</section>
	);
}
