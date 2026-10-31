import { Fragment, type CSSProperties } from "react";
import {
	Chevron,
	FileIcon,
	hasChildren,
	IndentGuides,
	VsCodeWindow,
} from "../ide";
import { L, Name } from "./inventory";
import { delay, MoreLink } from "./more-link";

type Dot = "o" | "s" | "c" | "r";

// [Luau name, roblox-ts name, depth, marker, class]
const tree: [string, string, number, Dot, string?][] = [
	["src/", "src/", 0, "o"],
	["Combat/", "combat/", 1, "o"],
	["Inventory/", "inventory/", 1, "o", "on"],
	["UI/", "ui/", 2, "r", "f"],
	["InventoryHud.luau", "inventory-hud.tsx", 3, "r", "f"],
	["ItemSlot.luau", "item-slot.tsx", 3, "r", "f"],
	[
		"InventoryController@Client.luau",
		"inventory-controller@client.ts",
		2,
		"c",
		"f",
	],
	[
		"InventoryService@Server.luau",
		"inventory-service@server.ts",
		2,
		"s",
		"f",
	],
	["InventoryTypes.luau", "inventory-types.ts", 2, "r", "f"],
	["ItemIcons.rbxm", "item-icons.ts", 2, "r", "f"],
	["Shop/", "shop/", 1, "o"],
];

// Rojo's commands through Rogen, with what each prints.
const ROJO_RUNS: Run[] = [
	{ command: "rogen build -o game.rbxl", output: ["Built game.rbxl."] },
	{
		command: "rogen sourcemap -o sourcemap.json",
		output: ["Wrote sourcemap.json."],
	},
	{
		command: "rogen syncback --input game.rbxl -y",
		output: ["Syncback wrote 2 changes."],
	},
	{
		command: "rogen serve",
		output: [
			"rogen serve · default.rogen.json",
			"Serving my-game at localhost:34872 · http://localhost:34872/",
			"  In Studio, press Connect in the Rojo plugin.",
		],
	},
];

const depth = (d: number) => ({ "--d": d }) as CSSProperties;
const depths = tree.map(([, , d]) => ({ depth: d }));

function TreeName({ name, dot }: { name: string; dot: Dot }) {
	const folder = name.endsWith("/");
	return (
		<>
			{!folder && <FileIcon name={name} />}
			<Name
				name={name.replace(/\/$/, "")}
				colour={dot === "o" ? undefined : dot}
			/>
		</>
	);
}

// A row of VS Code's explorer: [name, depth, selected].
type Row = [string, number, boolean?];
// A command typed in the terminal, and what it prints.
type Run = { command: string; output: string[] };

// A feature that requires another, and what each language's linter prints about it.
const BOUNDARY: Record<"luau" | "ts", { rows: Row[] } & Run> = {
	luau: {
		rows: [
			["src/", 0],
			["Combat/", 1],
			["CombatService@Server.luau", 2, true],
			["CombatTypes.luau", 2],
			["Inventory/", 1],
			["InventoryService@Server.luau", 2],
			["ItemCatalog.luau", 2],
		],
		command: "lute lint --no-default-lints src",
		output: [
			"error[require_boundaries]: feature Combat requires feature Inventory: ReplicatedStorage.Shared.Inventory.ItemCatalog",
			"",
			"   ┌── /Users/me/my-game/src/Combat/CombatService@Server.luau:4:21-76 ──",
			"   │",
			" 4 │ local ItemCatalog = require(ReplicatedStorage.Shared.Inventory.ItemCatalog)",
			"   │                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^",
		],
	},
	ts: {
		rows: [
			["src/", 0],
			["combat/", 1],
			["combat-service@server.ts", 2, true],
			["combat-types.ts", 2],
			["inventory/", 1],
			["inventory-service@server.ts", 2],
			["item-catalog.ts", 2],
		],
		command: "npx eslint src",
		output: [
			"/Users/me/my-game/src/combat/combat-service@server.ts",
			'  1:25  error  Unexpected path "../inventory/item-catalog" imported in restricted zone  import/no-restricted-paths',
			"",
			"✖ 1 problem (1 error, 0 warnings)",
		],
	},
};

// Two places that share src/common, in the layout each language's init writes, and what rogen where says of the game place.
const PLACES: Record<"luau" | "ts", { rows: Row[] } & Run> = {
	luau: {
		rows: [
			["src/", 0],
			["common/", 1],
			["Shop/", 2],
			["ItemCatalog.luau", 3],
			["ShopService@Server.luau", 3],
			["game/", 1],
			["Shop/", 2],
			["ItemCatalog.luau", 3, true],
			["lobby/", 1],
			["game.rogen.json", 0],
			["lobby.rogen.json", 0],
		],
		command: "rogen where game",
		output: [
			"src/common/Shop/ItemCatalog.luau -> replaced by src/game/Shop/ItemCatalog.luau",
			"src/common/Shop/ShopService@Server.luau -> ServerScriptService/Shop/ShopService · route Server (suffix)",
			"src/game/Shop/ItemCatalog.luau -> ReplicatedStorage/Shared/Shop/ItemCatalog · route * (fallback)",
		],
	},
	ts: {
		rows: [
			["projects/", 0],
			["common/", 1],
			["src/shop/", 2],
			["item-catalog.ts", 3],
			["shop-service@server.ts", 3],
			["tsconfig.json", 2],
			["game/", 1],
			["src/shop/", 2],
			["item-catalog.ts", 3, true],
			["default.rogen.json", 2],
			["tsconfig.json", 2],
			["lobby/", 1],
			["package.json", 0],
		],
		command: "rogen where projects/game/default.rogen.json",
		output: [
			"projects/common/src/shop/item-catalog.ts -> replaced by projects/game/src/shop/item-catalog.ts",
			"projects/common/src/shop/shop-service@server.ts -> ServerScriptService/shop/shop-service · route server (suffix)",
			"projects/game/src/shop/item-catalog.ts -> ReplicatedStorage/shared/shop/item-catalog · route * (fallback)",
		],
	},
};

const suffixColour = (name: string) =>
	/@server/i.test(name) ? "s" : /@client/i.test(name) ? "c" : undefined;

function Terminal({ runs, prompt = false }: { runs: Run[]; prompt?: boolean }) {
	return (
		<div className="ide-panel">
			<div className="ide-tabs" aria-hidden="true">
				<span>PROBLEMS</span>
				<span>OUTPUT</span>
				<span className="on">TERMINAL</span>
			</div>
			<div className="ide-term">
				{runs.map(({ command, output }, i) => (
					<Fragment key={i}>
						<span className="ln">
							<span className="ps">my-game %</span> {command}
						</span>
						{output.map((text, j) => (
							<span key={j} className="ln">
								{text || " "}
							</span>
						))}
					</Fragment>
				))}
				{prompt && (
					<span className="ln">
						<span className="cur" aria-hidden="true" />
					</span>
				)}
			</div>
		</div>
	);
}

/** VS Code's explorer over a terminal, in each language, as Boundaries and Places show them. */
function ExplorerAndTerminal({
	figure,
	delayMs,
}: {
	figure: typeof PLACES;
	delayMs: number;
}) {
	return (
		<div className="plate ide rv" style={delay(delayMs)}>
			{(["luau", "ts"] as const).map((lang) => {
				const { rows, command, output } = figure[lang];
				const depths = rows.map(([, depth]) => ({ depth }));
				return (
					<div key={lang} data-only={lang}>
						<VsCodeWindow title="my-game">
							<div className="ide-section">
								<Chevron open />
								MY-GAME
							</div>
							<ul className="ide-tree">
								{rows.map(([name, depth, chosen], i) => {
									const isFolder = name.endsWith("/");
									return (
										<li
											key={i}
											className={
												chosen ? "sel" : undefined
											}
											style={
												{
													"--d": depth,
												} as CSSProperties
											}
										>
											<IndentGuides depth={depth} />
											{isFolder && (
												<Chevron
													open={hasChildren(
														depths,
														i
													)}
												/>
											)}
											{!isFolder && (
												<FileIcon name={name} />
											)}
											<Name
												name={name.replace(/\/$/, "")}
												colour={suffixColour(name)}
											/>
										</li>
									);
								})}
							</ul>
							<Terminal runs={[{ command, output }]} />
						</VsCodeWindow>
					</div>
				);
			})}
		</div>
	);
}

export function Features() {
	return (
		<section className="sec why" aria-labelledby="why-h">
			<div className="wrap">
				<div className="cols">
					<div className="head-r">
						<h2 id="why-h" className="rv">
							One folder per feature from server to client
						</h2>
					</div>
				</div>

				<div className="cols r1">
					<div className="rtxt">
						<span className="n rv">01</span>
						<h3 className="rv" style={delay(60)}>
							Organize by feature
						</h3>
						<p className="rv" style={delay(120)}>
							Keep everything a feature needs in one folder, from
							its server code to its UI and assets. You find it
							all in one place, and you remove a feature by
							deleting its folder.
						</p>
						<MoreLink href="/docs/v2/architectures" dl={180}>
							See suggested architectures
						</MoreLink>
					</div>
					<div className="fpanel ide rv" style={delay(120)}>
						<VsCodeWindow title="my-game">
							<div className="ide-section">
								<Chevron open />
								MY-GAME
							</div>
							<ul
								className="ide-tree"
								aria-label="Example feature folder"
							>
								{tree.map(([luau, ts, d, dot, cls], i) => (
									<li
										key={luau}
										className={
											cls === "on" ? "sel" : undefined
										}
										style={depth(d)}
									>
										<IndentGuides depth={d} />
										{luau.endsWith("/") && (
											<Chevron
												open={hasChildren(depths, i)}
											/>
										)}
										<L
											luau={
												<TreeName
													name={luau}
													dot={dot}
												/>
											}
											ts={
												<TreeName name={ts} dot={dot} />
											}
										/>
									</li>
								))}
							</ul>
						</VsCodeWindow>
					</div>
				</div>

				<div className="split hl" data-line="">
					<div className="rtxt">
						<span className="n rv">02</span>
						<h3 className="rv" style={delay(60)}>
							Enforce boundaries
						</h3>
						<p className="rv" style={delay(120)}>
							Every require path includes the name of its feature,
							so a lint rule can stop one feature from reaching
							into another.
						</p>
						<MoreLink href="/docs/v2/linting" dl={180}>
							See the lint rule
						</MoreLink>
						<ExplorerAndTerminal figure={BOUNDARY} delayMs={240} />
					</div>
					<div className="rtxt">
						<span className="n rv" style={delay(80)}>
							03
						</span>
						<h3 className="rv" style={delay(140)}>
							Multi-place games
						</h3>
						<p className="rv" style={delay(200)}>
							Write shared code once and use it in every place.
							When one place needs its own version of a file, put
							a file with the same name in that place&apos;s
							folder, and it replaces the shared one.
						</p>
						<MoreLink href="/docs/v2/setups/places" dl={260}>
							Set up places
						</MoreLink>
						<ExplorerAndTerminal figure={PLACES} delayMs={320} />
					</div>
				</div>

				<div className="cols r4 hl" data-line="">
					<div className="rtxt">
						<span className="n rv">04</span>
						<h3 className="rv" style={delay(60)}>
							Still Rojo
						</h3>
						<p className="rv" style={delay(120)}>
							Run <code>rogen serve</code> where you ran{" "}
							<code>rojo serve</code>, with the same flags. Rojo
							still does the syncing and building underneath.
						</p>
						<MoreLink href="/docs/v2/coming-from-rojo" dl={180}>
							Coming from Rojo
						</MoreLink>
					</div>
					<div
						className="still ide rv"
						style={delay(120)}
						role="img"
						aria-label="VS Code's terminal running rogen build, sourcemap, syncback and serve, as Rojo's commands are run"
					>
						<VsCodeWindow title="my-game">
							<Terminal runs={ROJO_RUNS} prompt />
						</VsCodeWindow>
					</div>
				</div>
			</div>
		</section>
	);
}
