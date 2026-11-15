' PinRefSync - start the local sync helper hidden
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\GitHub\PinRefBoard"
sh.Run "cmd /c node tools\sync-server.mjs", 0, False
