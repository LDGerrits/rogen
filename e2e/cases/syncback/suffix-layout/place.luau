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

local server = game:GetService("ServerScriptService")
local quest = Instance.new("Folder")
quest.Name = "Quest"
quest.Parent = server
local main = Instance.new("ModuleScript")
main.Name = "Main"
main.Source = 'return "quest"\n'
main.Parent = quest

local boot = Instance.new("Script")
boot.Name = "Boot"
boot.Source = 'print("boot")\n'
boot.Parent = server
