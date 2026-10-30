local server = game:GetService("ServerScriptService")

local module = Instance.new("ModuleScript")
module.Name = "init"
module.Source = 'return "init"\n'
module.Parent = server.Inventory

local script = Instance.new("Script")
script.Name = "init"
script.Source = 'print("init")\n'
script.Parent = server.Shop
