"use client";

import { useState } from "react";
import {
	PreviewGroup,
	PreviewArrow,
	SystemWindow,
	StudioWindow,
	TreeFolder,
	TreeFile,
	TreeService,
	StudioFile,
} from "../file-tree-preview";

type ViewState = "folders" | "filenames" | "markers";

export function InteractivePreview() {
	const [activeView, setActiveView] = useState<ViewState>("folders");

	return (
		<section id="demo" className="py-24 px-6 relative overflow-hidden">
			<div className="absolute top-1/2 left-0 w-150 h-150 bg-white opacity-[0.075] blur-[100px] rounded-full pointer-events-none z-0 -translate-x-1/2 -translate-y-1/2" />

			<div className="max-w-6xl mx-auto relative z-10">
				<div className="text-left mb-12">
					<h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
						Preview
					</h2>
					<p className="text-gray-400 max-w-xl tracking-tight text-lg">
						See how Rogen routes your files into Roblox Studio
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

				<PreviewGroup>
					<SystemWindow>
						{activeView === "folders" && (
							<>
								<TreeFolder name="src" />
								<TreeFolder
									name="Inventory"
									level={1}
									open
									highlight
								/>
								<TreeFolder name="client" level={2} dim />
								<TreeFile
									name="InventoryController.luau"
									level={3}
								/>
								<TreeFolder name="server" level={2} dim />
								<TreeFile
									name="InventoryService.luau"
									level={3}
								/>
								<TreeFolder name="shared" level={2} dim />
								<TreeFile
									name="InventoryTypes.luau"
									level={3}
								/>
							</>
						)}
						{activeView === "filenames" && (
							<>
								<TreeFolder name="src" />
								<TreeFolder
									name="Combat"
									level={1}
									open
									highlight
								/>
								<TreeFile
									name="CombatController.client.luau"
									level={2}
								/>
								<TreeFile
									name="CombatService.server.luau"
									level={2}
								/>
								<TreeFile
									name="CombatTypes.shared.luau"
									level={2}
								/>
							</>
						)}
						{activeView === "markers" && (
							<>
								<TreeFolder name="src" />
								<TreeFolder
									name="anti-cheat"
									level={1}
									open
									highlight
								/>
								<TreeFile name=".server" level={2} marker />
								<TreeFile name="AntiCheat.luau" level={2} />
								<TreeFile name="Monitor.luau" level={2} />
							</>
						)}
					</SystemWindow>

					<PreviewArrow />

					<StudioWindow>
						{(activeView === "folders" ||
							activeView === "filenames") && (
							<>
								<TreeService
									name="ReplicatedStorage"
									type="replicated"
								/>
								<TreeFolder
									name={
										activeView === "filenames"
											? "Combat"
											: "Inventory"
									}
									level={1}
									highlight
								/>
								<StudioFile
									name={
										activeView === "filenames"
											? "CombatTypes"
											: "InventoryTypes"
									}
									level={2}
								/>

								<TreeService
									name="ServerScriptService"
									type="server"
									mt
								/>
								<TreeFolder
									name={
										activeView === "filenames"
											? "Combat"
											: "Inventory"
									}
									level={1}
									highlight
								/>
								<StudioFile
									name={
										activeView === "filenames"
											? "CombatService"
											: "InventoryService"
									}
									level={2}
								/>

								<TreeService
									name="StarterPlayerScripts"
									type="player"
									mt
								/>
								<TreeFolder
									name={
										activeView === "filenames"
											? "Combat"
											: "Inventory"
									}
									level={1}
									highlight
								/>
								<StudioFile
									name={
										activeView === "filenames"
											? "CombatController"
											: "InventoryController"
									}
									level={2}
								/>
							</>
						)}
						{activeView === "markers" && (
							<>
								<TreeService
									name="ServerScriptService"
									type="server"
								/>
								<TreeFolder
									name="anti-cheat"
									level={1}
									highlight
								/>
								<StudioFile name="AntiCheat" level={2} />
								<StudioFile name="Monitor" level={2} />
							</>
						)}
					</StudioWindow>
				</PreviewGroup>
			</div>
		</section>
	);
}
