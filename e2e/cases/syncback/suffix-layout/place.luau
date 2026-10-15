local inventory = game:GetService("ServerScriptService").Inventory
inventory.Save.Source = 'return "save2"\n'

local mail = Instance.new("ModuleScript")
mail.Name = "Mail"
mail.Source = 'return "mail"\n'
mail.Parent = inventory

local itemTypes = Instance.new("ModuleScript")
itemTypes.Name = "ItemTypes"
itemTypes.Source = 'return "items"\n'
itemTypes.Parent = game:GetService("ReplicatedStorage").Shared.Inventory
