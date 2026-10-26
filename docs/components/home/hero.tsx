import { HeroDemo } from "./hero-demo";
import { InstallCommand } from "./install-command";
import { LangSwitch } from "./lang-switch";

export function Hero() {
	return (
		<section className="hero">
			<div className="wrap">
				<div className="cols hero-row">
					<div className="hero-h">
						<span className="eyebrow in-1">
							Rojo with file-system routing
						</span>
						<h1 className="in-2">
							<span>Professional-grade</span> architecture for
							Roblox
						</h1>
						<p className="lede in-3">
							Rogen is a superset of Rojo that generates Rojo
							project files from your file system. You organize
							your game by feature, and Rogen puts each file in
							the right place.
						</p>
					</div>
					<div className="hero-copy">
						<InstallCommand className="in-4" />
						<LangSwitch className="in-5" />
					</div>
				</div>
				<HeroDemo />
			</div>
		</section>
	);
}
