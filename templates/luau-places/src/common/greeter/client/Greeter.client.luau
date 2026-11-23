local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Greeting = require(ReplicatedStorage.Shared.greeter.Greeting)

print(Greeting("client"))
