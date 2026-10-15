local server = game:GetService("ServerScriptService")
local bag = server.Inventory.Bag
bag.Source = "return 2\n"
bag:SetAttribute("Level", 5)
server.Inventory.Save:SetAttribute("Fresh", true)

local kiosk = server.Shop.Kiosk
kiosk.Item:Destroy()
local new = Instance.new("ModuleScript")
new.Name = "New"
new.Source = 'return "new"\n'
new.Parent = kiosk

local bar = game:GetService("StarterPlayer").StarterPlayerScripts.Hud.Bar
bar.Source = 'print("bar2")\n'
