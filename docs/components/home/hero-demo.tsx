"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { glyphs, icons, type Icon, type Service } from "./explorer";

type DiskRow = [name: string, depth: number, key?: string, colour?: Service];
type StudioRow = [
	key: string,
	name: string,
	depth: number,
	icon: Icon,
	colour: Service,
];

const disk: DiskRow[] = [
	["src/", 0],
	["Inventory/", 1],
	["UI/", 2],
	["InventoryHud.luau", 3, "hud", "r"],
	["ItemSlot.luau", 3, "slot", "r"],
	["InventoryController@Client.luau", 2, "ctrl", "c"],
	["InventoryInput@Client.luau", 2, "input", "c"],
	["InventoryService@Server.luau", 2, "svc", "s"],
	["InventoryStore@Server.luau", 2, "store", "s"],
	["InventoryTypes.luau", 2, "types", "r"],
	["ItemCatalog.luau", 2, "cat", "r"],
	["ItemIcons.rbxm", 2, "icons", "r"],
];
const depths = disk.map((row) => row[1]);

const studio: StudioRow[] = [
	["", "ReplicatedStorage", 0, "svc", "r"],
	["", "Shared", 1, "dir", "r"],
	["", "Inventory", 2, "dir", "r"],
	["types", "InventoryTypes", 3, "scr", "r"],
	["cat", "ItemCatalog", 3, "scr", "r"],
	["icons", "ItemIcons", 3, "mdl", "r"],
	["", "UI", 3, "dir", "r"],
	["hud", "InventoryHud", 4, "scr", "r"],
	["slot", "ItemSlot", 4, "scr", "r"],
	["", "ServerScriptService", 0, "svc", "s"],
	["", "Inventory", 1, "dir", "s"],
	["svc", "InventoryService", 2, "scr", "s"],
	["store", "InventoryStore", 2, "scr", "s"],
	["", "StarterPlayer", 0, "svc", "c"],
	["", "StarterPlayerScripts", 1, "dir", "c"],
	["", "Inventory", 2, "dir", "c"],
	["ctrl", "InventoryController", 3, "scr", "c"],
	["input", "InventoryInput", 3, "scr", "c"],
];

// The order the highlight visits the files in.
const cycle = [
	"svc",
	"ctrl",
	"types",
	"hud",
	"store",
	"input",
	"cat",
	"icons",
	"slot",
];
const COMMAND = "rogen serve";

function Name({ name, colour }: { name: string; colour?: Service }) {
	const at = name.indexOf("@");
	if (at < 0) return <span className="nm">{name}</span>;
	const dot = name.lastIndexOf(".");
	return (
		<span className="nm">
			{name.slice(0, at)}
			<span className={`c-${colour}`}>{name.slice(at, dot)}</span>
			{name.slice(dot)}
		</span>
	);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** rogen serve in a terminal, then each file of src/Inventory wired to where it lands in the Studio Explorer. */
export function HeroDemo() {
	const ref = useRef<HTMLElement>(null);

	useEffect(() => {
		const win = ref.current;
		if (!win) return;
		const split = win.querySelector<HTMLElement>("[data-split]")!;
		const wires = win.querySelector<SVGSVGElement>("[data-wires]")!;
		const typed = win.querySelector<HTMLElement>("[data-typed]")!;
		const lines = [...win.querySelectorAll<HTMLElement>("[data-l]")];
		const arrivals = [...win.querySelectorAll<HTMLElement>(".x.arr")];
		let active = cycle[0];
		let timer = 0;
		let hovering = false;
		let visible = true;
		let ready = false;
		let cancelled = false;

		const setActive = (k: string) => {
			active = k;
			win.querySelectorAll<HTMLElement>("[data-k]").forEach((el) =>
				el.classList.toggle("on", el.dataset.k === k)
			);
			wires
				.querySelectorAll<SVGPathElement>("path")
				.forEach((p) => p.classList.toggle("on", p.dataset.k === k));
		};
		const next = () => {
			clearTimeout(timer);
			if (hovering || !visible || !ready) return;
			timer = window.setTimeout(() => {
				setActive(cycle[(cycle.indexOf(active) + 1) % cycle.length]);
				next();
			}, 2000);
		};

		const draw = () => {
			if (getComputedStyle(wires).display === "none") return;
			const s = split.getBoundingClientRect();
			wires.setAttribute("viewBox", `0 0 ${s.width} ${s.height}`);
			wires.innerHTML = cycle
				.map((k) => {
					const from = win
						.querySelector(`.tree [data-k="${k}"] .nm`)!
						.getBoundingClientRect();
					const row = win.querySelector<HTMLElement>(
						`.xt [data-k="${k}"]`
					)!;
					const to = row
						.querySelector(".ic")!
						.getBoundingClientRect();
					const x1 = from.right - s.left + 10;
					const y1 = from.top - s.top + from.height / 2;
					const x2 = to.left - s.left - 24;
					const y2 = to.top - s.top + to.height / 2;
					const m = (x1 + x2) / 2;
					return `<path data-k="${k}" class="w-${row.dataset.c}" pathLength="1" d="M${x1.toFixed(1)} ${y1.toFixed(1)} C${m.toFixed(1)} ${y1.toFixed(1)} ${m.toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
				})
				.join("");
			setActive(active);
		};

		// Types the command, prints the serve log and fills the Explorer once.
		const play = async () => {
			win.classList.add("play");
			typed.textContent = "";
			await sleep(700);
			for (let i = 1; i <= COMMAND.length && !cancelled; i++) {
				typed.textContent = COMMAND.slice(0, i);
				await sleep(55);
			}
			for (const [i, ms] of [280, 380, 420].entries()) {
				await sleep(ms);
				if (cancelled) return;
				lines[i].classList.add("in");
			}
			for (const row of arrivals) {
				await sleep(40);
				if (cancelled) return;
				row.classList.add("in");
			}
			await sleep(120);
			if (cancelled) return;
			wires.classList.add("in");
			lines[3].classList.add("in");
			await sleep(900);
			ready = true;
			next();
		};

		const enter = (e: Event) => {
			const k = (e.currentTarget as HTMLElement).dataset.k!;
			hovering = true;
			clearTimeout(timer);
			setActive(k);
		};
		const leave = () => {
			hovering = false;
			next();
		};
		const hoverable = [
			...win.querySelectorAll<HTMLElement>("[data-k]"),
		].filter((el) => el.tagName === "LI");
		hoverable.forEach((el) => {
			el.addEventListener("mouseenter", enter);
			el.addEventListener("mouseleave", leave);
		});

		draw();
		document.fonts?.ready.then(draw);
		addEventListener("resize", draw);
		const io = new IntersectionObserver(([e]) => {
			visible = e.isIntersecting;
			if (visible) next();
			else clearTimeout(timer);
		});
		io.observe(win);
		play();

		return () => {
			cancelled = true;
			clearTimeout(timer);
			io.disconnect();
			removeEventListener("resize", draw);
			hoverable.forEach((el) => {
				el.removeEventListener("mouseenter", enter);
				el.removeEventListener("mouseleave", leave);
			});
			win.classList.remove("play");
			typed.textContent = COMMAND;
			[...lines, ...arrivals, wires].forEach((el) =>
				el.classList.remove("in")
			);
		};
	}, []);

	return (
		<figure
			ref={ref}
			className="win"
			aria-label="rogen serve in a terminal, then the files of the Inventory feature on disk, each wired to where it appears in the Roblox Studio Explorer"
		>
			<div className="win-bar" aria-hidden="true">
				<span className="dots">
					<i />
					<i />
					<i />
				</span>
				<span>~/game</span>
				<span />
			</div>
			<div className="term">
				<span className="ln">
					<span className="ps">~/game</span>{" "}
					<span className="fr">$</span>{" "}
					<span className="cmd-t" data-typed="">
						{COMMAND}
					</span>
				</span>
				<span className="ln" data-l="">
					<span className="fr">┌</span> rogen serve ·
					default.rogen.json
				</span>
				<span className="ln" data-l="">
					<span className="fr">│</span> <span className="ok">✔</span>{" "}
					<span className="tx">
						Serving default.rogen.json with Rojo at localhost:34872
						(Studio lists it as Game).
					</span>
				</span>
				<span className="ln" data-l="">
					<span className="fr">│</span> Studio connected to
					default.rogen.json.
				</span>
				<span className="ln" data-l="">
					<span className="fr">│</span>{" "}
					<span className="cur" aria-hidden="true" />
				</span>
			</div>
			<div className="wsplit" data-split="">
				<div className="side">
					<div className="pane-h">
						<b>src/</b>
						<span>On disk</span>
					</div>
					<ul className="tree">
						{disk.map(([name, depth, key, colour], i) => (
							<li
								key={name}
								data-k={key}
								className={
									[!key && "b", colour && `k-${colour}`]
										.filter(Boolean)
										.join(" ") || undefined
								}
							>
								<span className="band" />
								<span className="g">{glyphs(depths, i)}</span>
								<Name name={name} colour={colour} />
							</li>
						))}
					</ul>
				</div>
				<div className="side">
					<div className="pane-h">
						<b>Explorer</b>
						<span>Roblox Studio</span>
					</div>
					<ul className="xt">
						{studio.map(([key, name, depth, icon, colour], i) => (
							<li
								key={i}
								data-k={key || undefined}
								data-c={colour}
								className={`x k-${colour}${icon === "svc" ? " svc" : " arr"}`}
								style={{ "--d": depth } as CSSProperties}
							>
								<span className="band" />
								<svg
									className="ic"
									viewBox="0 0 16 16"
									aria-hidden="true"
									dangerouslySetInnerHTML={{
										__html: icons[icon],
									}}
								/>
								<span className="nm">{name}</span>
							</li>
						))}
					</ul>
				</div>
				<svg className="wires" data-wires="" aria-hidden="true" />
			</div>
		</figure>
	);
}
