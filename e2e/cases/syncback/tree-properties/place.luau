local version = game:GetService("ReplicatedStorage").Version
version.Value = "2.0"
version:SetAttribute("Build", 7)

game:GetService("ServerScriptService").LoadStringEnabled = true
