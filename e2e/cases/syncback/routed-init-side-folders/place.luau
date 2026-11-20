local function add(parent, name)
	local module = Instance.new("ModuleScript")
	module.Name = name
	module.Source = "return {}\n"
	module.Parent = parent
end
add(game:GetService("StarterPlayer").StarterPlayerScripts.Shop, "Mouse")
add(game:GetService("ServerScriptService").Shop, "Audit")
game:GetService("StarterPlayer").StarterPlayerScripts.Shop.Source = 'return "client"\n'
