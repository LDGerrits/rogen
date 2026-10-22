local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Greeting = require(ReplicatedStorage.Shared.Greeter.Greeting)

print(Greeting("{{place}}"))
