local ReplicatedStorage = game:GetService("ReplicatedStorage")

local greeting = require(ReplicatedStorage.Shared.greeter.greeting)

print(greeting("client"))
