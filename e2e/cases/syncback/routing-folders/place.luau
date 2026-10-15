local server = game:GetService("ServerScriptService")
server.Combat.Combat.Source = 'return "combat2"\n'
server.Combat.Hit:Destroy()

local loot = Instance.new("ModuleScript")
loot.Name = "Loot"
loot.Source = 'return "loot"\n'
loot.Parent = server.Combat

local mail = Instance.new("ModuleScript")
mail.Name = "Mail"
mail.Source = 'return "mail"\n'
mail.Parent = server.Inventory

local quest = Instance.new("Folder")
quest.Name = "Quest"
quest.Parent = server
local main = Instance.new("ModuleScript")
main.Name = "Main"
main.Source = 'return "quest"\n'
main.Parent = quest
