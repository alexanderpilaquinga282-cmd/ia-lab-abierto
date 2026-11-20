Option Explicit

Dim fso, shell, node, edge, script, status, codex, command
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

If WScript.Arguments.Count > 3 Then
    MsgBox "El acceso directo tiene una configuracion invalida.", 48, "IA Lab Abierto"
    WScript.Quit 1
End If

node = fso.BuildPath(shell.ExpandEnvironmentStrings("%ProgramFiles%"), "nodejs\node.exe")
edge = fso.BuildPath(shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%"), "Microsoft\Edge\Application\msedge.exe")
If Not fso.FileExists(edge) Then
    edge = fso.BuildPath(shell.ExpandEnvironmentStrings("%ProgramFiles%"), "Microsoft\Edge\Application\msedge.exe")
End If
If WScript.Arguments.Count >= 2 Then
    node = WScript.Arguments(0)
    edge = WScript.Arguments(1)
End If
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "servidor.mjs")

If Not (fso.FileExists(node) And fso.FileExists(edge) And fso.FileExists(script)) Then
    MsgBox "El acceso directo no encuentra Node, Edge o el chat.", 48, "IA Lab Abierto"
    WScript.Quit 1
End If

command = Quote(node) & " " & Quote(script) & " " & Quote(edge)
If WScript.Arguments.Count = 3 Then
    codex = WScript.Arguments(2)
    If fso.FileExists(codex) Then command = command & " " & Quote(codex)
End If
status = shell.Run(command, 0, True)
If status <> 0 Then
    MsgBox "El chat no pudo iniciarse. Abre el acceso directo de nuevo.", 48, "IA Lab Abierto"
End If
WScript.Quit status

Function Quote(value)
    Quote = Chr(34) & value & Chr(34)
End Function
