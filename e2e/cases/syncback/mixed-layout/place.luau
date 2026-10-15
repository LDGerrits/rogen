local inventory = game:GetService("ServerScriptService").Inventory
inventory.Save.Source = 'return "save3"\n'

local mail = Instance.new("ModuleScript")
mail.Name = "Mail"
mail.Source = 'return "mail"\n'
mail.Parent = inventory
