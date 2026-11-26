local inventory = game:GetService("ServerScriptService").Inventory
inventory.Bag.Source = "return 2\n"

local spec = Instance.new("ModuleScript")
spec.Name = "Mail.spec"
spec.Source = 'return "spec"\n'
spec.Parent = inventory
