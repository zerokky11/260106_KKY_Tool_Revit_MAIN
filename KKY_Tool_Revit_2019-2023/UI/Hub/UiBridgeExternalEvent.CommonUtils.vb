Option Explicit On
Option Strict On

Imports System
Imports System.Collections.Generic

Namespace UI.Hub
    Partial Public Class UiBridgeExternalEvent

        Private Shared Function GetDictValue(dict As Dictionary(Of String, Object), key As String) As Object
            If dict Is Nothing OrElse String.IsNullOrWhiteSpace(key) Then Return Nothing
            Dim v As Object = Nothing
            If dict.TryGetValue(key, v) Then Return v
            Return Nothing
        End Function

        Private Shared Function SafeStr(o As Object) As String
            If o Is Nothing OrElse o Is DBNull.Value Then Return String.Empty
            Return Convert.ToString(o)
        End Function

    End Class
End Namespace
