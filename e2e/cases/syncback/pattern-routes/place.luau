local client = game:GetService("StarterPlayer").StarterPlayerScripts.Shop
local shared = game:GetService("ReplicatedStorage").Shared.Shop
local function add(parent, name)
	local module = Instance.new("ModuleScript")
	module.Name = name
	module.Source = "return {}\n"
	module.Parent = parent
end
add(client, "CartController")
add(client, "Cart")
add(shared, "PriceService")
