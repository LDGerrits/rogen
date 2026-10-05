"use client";

import { useState } from "react";
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

const views: Record<
	ViewState,
	{ label: string; disk: Row[]; studio: Row[] }
> = {
	folders: {
		label: "Routing Folders",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Inventory", level: 1, kind: "feature" },
			{ name: "Client", level: 2, kind: "routing" },
			{ name: "InventoryController.luau", level: 3, kind: "script" },
			{ name: "Server", level: 2, kind: "routing" },
			{ name: "InventoryService.luau", level: 3, kind: "script" },
			{ name: "Shared", level: 2, kind: "routing" },
			{ name: "InventoryTypes.luau", level: 3, kind: "script" },
		],
		studio: studioTree(
			"Inventory",
			["InventoryTypes"],
			["InventoryService"],
			["InventoryController"]
		),
	},
	at: {
		label: "The @ Sign",
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "Combat", level: 1, kind: "feature" },
			{ name: "CombatController@client.luau", level: 2, kind: "script" },
			{ name: "CombatService@server.luau", level: 2, kind: "script" },
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
		disk: [
			{ name: "src", level: 0, kind: "root" },
			{ name: "AntiCheat", level: 1, kind: "feature" },
			{ name: ".server", level: 2, kind: "marker" },
			{ name: "AntiCheatService.luau", level: 2, kind: "script" },
			{ name: "Monitor.luau", level: 2, kind: "script" },
		],
		studio: studioTree("AntiCheat", [], ["AntiCheatService", "Monitor"], []),
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

export function Preview() {
	const [activeView, setActiveView] = useState<ViewState>("folders");
	const view = views[activeView];

	return (
		<section id="demo" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 left-25 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-start text-left mb-12">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Preview
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						See where each file ends up in Roblox Studio.
					</p>
				</div>

				<div className="w-full flex justify-start mb-8 relative z-20">
					<div className="flex p-1 bg-[#0a0a0a] border border-white/10 rounded-lg shadow-2xl backdrop-blur-md">
						{(Object.keys(views) as ViewState[]).map((id) => (
							<button
								key={id}
								onClick={() => setActiveView(id)}
								className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
									activeView === id
										? "bg-white/10 text-white shadow-sm"
										: "text-gray-500 hover:text-gray-300 hover:bg-white/5"
								}`}
							>
								{views[id].label}
							</button>
						))}
					</div>
				</div>

				<div className="w-full flex flex-col md:flex-row items-stretch justify-start gap-4 relative text-left">
					<div className="flex-1 bg-[#050505] rounded-xl border border-white/10 overflow-hidden z-10 flex flex-col shadow-2xl transition-all">
						<div className="bg-[#0a0a0a] px-4 py-3 flex items-center gap-3 border-b border-white/10">
							<FaTerminal className="text-gray-500 text-sm" />
							<span className="text-xs font-mono text-gray-400 tracking-wide uppercase">
								File System
							</span>
						</div>
						<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto min-h-80">
							<Tree rows={view.disk} />
						</div>
					</div>

					<div className="flex items-center justify-center z-20 py-8 md:py-0 px-4 md:px-6">
						<svg
							className="text-gray-500 md:rotate-0 rotate-90 transition-colors duration-300 hover:text-white"
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

					<div className="flex-1 bg-[#050505] rounded-xl border border-white/10 overflow-hidden z-10 flex flex-col shadow-2xl transition-all">
						<div className="bg-[#0a0a0a] px-4 py-3 flex items-center gap-3 border-b border-white/10">
							<SiRoblox className="text-gray-400 text-sm" />
							<span className="text-xs font-mono text-gray-400 tracking-wide uppercase">
								Roblox Studio
							</span>
						</div>
						<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto min-h-80">
							<Tree rows={view.studio} />
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
