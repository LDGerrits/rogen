"use client";

import { useState } from "react";
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

type ViewState = "folders" | "filenames" | "markers";

export function Preview() {
	const [activeView, setActiveView] = useState<ViewState>("folders");

	return (
		<section id="demo" className="py-24 px-6 relative">
			<div className="max-w-6xl mx-auto relative z-10">
				<div className="absolute top-20 left-25 w-100 h-100 bg-white opacity-[0.05] blur-[80px] rounded-full pointer-events-none -z-10 -translate-x-1/2 -translate-y-1/2" />

				<div className="flex flex-col items-start text-left mb-12">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Preview
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						See how Rogen routes files into Roblox Studio
					</p>
				</div>

				<div className="w-full flex justify-start mb-8 relative z-20">
					<div className="flex p-1 bg-[#0a0a0a] border border-white/10 rounded-lg shadow-2xl backdrop-blur-md">
						{[
							{ id: "folders", label: "Folder Names" },
							{ id: "filenames", label: "File Names" },
							{ id: "markers", label: "Marker Files" },
						].map((tab) => (
							<button
								key={tab.id}
								onClick={() =>
									setActiveView(tab.id as ViewState)
								}
								className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
									activeView === tab.id
										? "bg-white/10 text-white shadow-sm"
										: "text-gray-500 hover:text-gray-300 hover:bg-white/5"
								}`}
							>
								{tab.label}
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
						<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto min-h-70">
							{activeView === "folders" && (
								<>
									<div className="flex items-center gap-2">
										<FaFolder className="text-gray-600" />{" "}
										src
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolderOpen className="text-white" />{" "}
										<span className="text-white font-medium">
											Inventory
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8 opacity-50">
										<FaFolder className="text-gray-500" />{" "}
										client
									</div>
									<div className="flex items-center gap-2 ml-12">
										<FaFileCode className="text-white" />{" "}
										InventoryController.luau
									</div>
									<div className="flex items-center gap-2 ml-8 opacity-50">
										<FaFolder className="text-gray-500" />{" "}
										server
									</div>
									<div className="flex items-center gap-2 ml-12">
										<FaFileCode className="text-white" />{" "}
										InventoryService.luau
									</div>
									<div className="flex items-center gap-2 ml-8 opacity-50">
										<FaFolder className="text-gray-500" />{" "}
										shared
									</div>
									<div className="flex items-center gap-2 ml-12">
										<FaFileCode className="text-white" />{" "}
										InventoryTypes.luau
									</div>
								</>
							)}
							{activeView === "filenames" && (
								<>
									<div className="flex items-center gap-2">
										<FaFolder className="text-gray-600" />{" "}
										src
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolderOpen className="text-white" />{" "}
										<span className="text-white font-medium">
											Combat
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileCode className="text-white" />{" "}
										CombatControllerClient.luau
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileCode className="text-white" />{" "}
										CombatServiceServer.luau
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileCode className="text-white" />{" "}
										CombatTypes.luau
									</div>
								</>
							)}
							{activeView === "markers" && (
								<>
									<div className="flex items-center gap-2">
										<FaFolder className="text-gray-600" />{" "}
										src
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolderOpen className="text-white" />{" "}
										<span className="text-white font-medium">
											AntiCheat
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8 opacity-50">
										<FaFileAlt className="text-gray-500" />{" "}
										.server
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileCode className="text-white" />{" "}
										AntiCheatService.luau
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileCode className="text-white" />{" "}
										Monitor.luau
									</div>
								</>
							)}
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
						<div className="p-6 font-mono text-sm leading-8 text-gray-400 whitespace-nowrap overflow-x-auto min-h-70">
							{(activeView === "folders" ||
								activeView === "filenames") && (
								<>
									<div className="flex items-center gap-2">
										<FaBox className="text-gray-600" />{" "}
										ReplicatedStorage
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolder className="text-white" />{" "}
										<span className="text-white font-medium">
											{activeView === "filenames"
												? "Combat"
												: "Inventory"}
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										{activeView === "filenames"
											? "CombatTypes"
											: "InventoryTypes"}
									</div>

									<div className="flex items-center gap-2 mt-3">
										<FaServer className="text-gray-600" />{" "}
										ServerScriptService
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolder className="text-white" />{" "}
										<span className="text-white font-medium">
											{activeView === "filenames"
												? "Combat"
												: "Inventory"}
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										{activeView === "filenames"
											? "CombatService"
											: "InventoryService"}
									</div>

									<div className="flex items-center gap-2 mt-3">
										<FaUser className="text-gray-600" />{" "}
										StarterPlayerScripts
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolder className="text-white" />{" "}
										<span className="text-white font-medium">
											{activeView === "filenames"
												? "Combat"
												: "Inventory"}
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										{activeView === "filenames"
											? "CombatController"
											: "InventoryController"}
									</div>
								</>
							)}
							{activeView === "markers" && (
								<>
									<div className="flex items-center gap-2">
										<FaServer className="text-gray-600" />{" "}
										ServerScriptService
									</div>
									<div className="flex items-center gap-2 ml-4">
										<FaFolder className="text-white" />{" "}
										<span className="text-white font-medium">
											AntiCheat
										</span>
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										AntiCheatService
									</div>
									<div className="flex items-center gap-2 ml-8">
										<FaFileAlt className="text-gray-400" />{" "}
										Monitor
									</div>
								</>
							)}
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
