local bag = Instance.new("Folder")
bag.Name = "Bag"
bag:SetAttribute("Level", 3)
bag.Parent = game.ServerScriptService.Shop
local inner = Instance.new("Folder")
inner.Name = "Inner"
inner.Parent = bag
