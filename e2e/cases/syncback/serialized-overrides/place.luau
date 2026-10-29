for _, instance in game:GetDescendants() do
	instance.SerializedOverrides = ""
end

game:GetService("ServerScriptService").Combat.Hit:SetAttribute("Damage", 5)
game:GetService("ReplicatedStorage").Shared:SetAttribute("Version", 2)
