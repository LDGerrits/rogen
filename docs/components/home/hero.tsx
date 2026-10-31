import { HeroDemo } from "./hero-demo";
import { InstallCommand } from "./install-command";
import { LangSwitch } from "./lang-switch";

export function Hero() {
	return (
		<section className="hero">
			<div className="wrap">
				<div className="cols hero-row">
					<div className="hero-h">
						<span className="eyebrow in-1">A Rojo superset</span>
						<h1 className="in-2">
							Each feature in <span>one folder</span>
						</h1>
						<p className="lede in-3">
							Rogen generates the Rojo project file from your file
							system. Keep a feature&apos;s server and client code
							together, and Rogen sends each file to the right
							place in Studio.
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
