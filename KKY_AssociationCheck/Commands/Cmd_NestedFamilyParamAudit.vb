Option Strict On
Option Explicit On

Imports Autodesk.Revit.Attributes
Imports Autodesk.Revit.DB
Imports Autodesk.Revit.UI
Imports System
Imports System.Collections.Generic
Imports System.ComponentModel
Imports System.IO
Imports System.Linq
Imports System.Text
Imports System.Text.RegularExpressions
Imports System.Windows.Forms

Namespace KKY_Tool_Revit

    <Transaction(TransactionMode.Manual)>
    Public Class Cmd_NestedFamilyParamAudit
        Implements IExternalCommand

        Public Function Execute(commandData As ExternalCommandData,
                                ByRef message As String,
                                elements As ElementSet) As Result Implements IExternalCommand.Execute
            Try
                Dim uiapp As UIApplication = commandData.Application
                Using f As New AuditForm(uiapp)
                    f.ShowDialog(New RevitWin32Window(uiapp.MainWindowHandle))
                End Using
                Return Result.Succeeded
            Catch ex As Exception
                message = ex.ToString()
                Return Result.Failed
            End Try
        End Function
    End Class

    Friend Class RevitWin32Window
        Implements IWin32Window

        Private ReadOnly _handle As IntPtr

        Public Sub New(handle As IntPtr)
            _handle = handle
        End Sub

        Public ReadOnly Property Handle As IntPtr Implements IWin32Window.Handle
            Get
                Return _handle
            End Get
        End Property
    End Class

    Friend Enum AuditIssueType
        OK
        MissingAssociation
        SuspiciousAssociation
        SharedTypeDrivenConflict
        [Error]
    End Enum

    Friend Enum ParamScope
        InstanceParam
        TypeParam
        TypeSelection
    End Enum

    Friend Class AuditRow
        Public Property ProjectPath As String = ""

        Public Property HostFamilyName As String = ""
        Public Property HostFamilyCategory As String = ""

        Public Property NestedFamilyName As String = ""
        Public Property NestedTypeName As String = ""
        Public Property NestedCategory As String = ""
        Public Property NestedIsShared As Boolean

        Public Property NestedParamScope As String = ""
        Public Property NestedParamName As String = ""
        Public Property NestedParamType As String = ""

        Public Property AssocHostParamName As String = ""
        Public Property AssocHostParamIsInstance As String = ""
        Public Property AssocHostParamIsShared As String = ""
        Public Property AssocHostParamIsReporting As String = ""
        Public Property AssocHostParamFormula As String = ""

        Public Property Issue As String = ""
        Public Property Notes As String = ""
    End Class

    Friend Class AuditForm
        Inherits System.Windows.Forms.Form

        Private ReadOnly _uiapp As UIApplication

        Private ReadOnly lstFiles As New ListBox()
        Private ReadOnly btnAdd As New Button()
        Private ReadOnly btnRemove As New Button()
        Private ReadOnly btnClear As New Button()
        Private ReadOnly btnScan As New Button()
        Private ReadOnly btnExport As New Button()
        Private ReadOnly btnClose As New Button()

        Private ReadOnly chkOnlyImportant As New CheckBox()
        Private ReadOnly chkIncludeTypeSelection As New CheckBox()
        Private ReadOnly chkRecursive As New CheckBox()
        Private ReadOnly numMaxDepth As New NumericUpDown()

        Private ReadOnly dgv As New DataGridView()
        Private ReadOnly lblStatus As New System.Windows.Forms.Label()
        Private ReadOnly pbar As New ProgressBar()

        Private _rows As List(Of AuditRow) = New List(Of AuditRow)()

        Public Sub New(uiapp As UIApplication)
            _uiapp = uiapp
            BuildUi()
        End Sub

        Private Sub BuildUi()
            Text = "Nested Family Parameter Link Audit (POC)"
            Width = 1280
            Height = 720
            StartPosition = FormStartPosition.CenterScreen

            Dim root As New TableLayoutPanel() With {
                .Dock = DockStyle.Fill,
                .RowCount = 2,
                .ColumnCount = 1
            }
            root.RowStyles.Add(New RowStyle(SizeType.Absolute, 90))
            root.RowStyles.Add(New RowStyle(SizeType.Percent, 100))

            Dim top As New TableLayoutPanel() With {
                .Dock = DockStyle.Fill,
                .RowCount = 2,
                .ColumnCount = 10
            }
            For i As Integer = 0 To 9
                top.ColumnStyles.Add(New ColumnStyle(SizeType.Percent, 10))
            Next
            top.RowStyles.Add(New RowStyle(SizeType.Absolute, 34))
            top.RowStyles.Add(New RowStyle(SizeType.Absolute, 56))

            btnAdd.Text = "RVT 추가..."
            btnRemove.Text = "선택 제거"
            btnClear.Text = "목록 지우기"
            btnScan.Text = "스캔 실행"
            btnExport.Text = "CSV 저장..."
            btnClose.Text = "닫기"

            AddHandler btnAdd.Click, AddressOf OnAddFiles
            AddHandler btnRemove.Click, AddressOf OnRemoveSelected
            AddHandler btnClear.Click, AddressOf OnClearFiles
            AddHandler btnScan.Click, AddressOf OnScan
            AddHandler btnExport.Click, AddressOf OnExport
            AddHandler btnClose.Click, Sub() Close()

            chkOnlyImportant.Text = "주요 파라미터만 검사(권장)"
            chkOnlyImportant.Checked = True

            chkIncludeTypeSelection.Text = "네스티드 타입 선택(Type) 연동도 검사"
            chkIncludeTypeSelection.Checked = True

            chkRecursive.Text = "중첩 패밀리도 재귀 스캔(호스트로 별도 검사)"
            chkRecursive.Checked = False

            numMaxDepth.Minimum = 1
            numMaxDepth.Maximum = 5
            numMaxDepth.Value = 2
            numMaxDepth.Enabled = chkRecursive.Checked
            AddHandler chkRecursive.CheckedChanged, Sub()
                                                        numMaxDepth.Enabled = chkRecursive.Checked
                                                    End Sub

            lblStatus.Text = "준비됨"
            lblStatus.AutoSize = True

            pbar.Style = ProgressBarStyle.Blocks
            pbar.Minimum = 0
            pbar.Maximum = 100
            pbar.Value = 0
            pbar.Dock = DockStyle.Fill

            top.Controls.Add(btnAdd, 0, 0)
            top.Controls.Add(btnRemove, 1, 0)
            top.Controls.Add(btnClear, 2, 0)
            top.Controls.Add(btnScan, 3, 0)
            top.Controls.Add(btnExport, 4, 0)
            top.Controls.Add(btnClose, 5, 0)

            top.Controls.Add(chkOnlyImportant, 6, 0)
            top.SetColumnSpan(chkOnlyImportant, 4)

            top.Controls.Add(chkIncludeTypeSelection, 0, 1)
            top.SetColumnSpan(chkIncludeTypeSelection, 3)

            top.Controls.Add(chkRecursive, 3, 1)
            top.SetColumnSpan(chkRecursive, 3)

            Dim depthPanel As New FlowLayoutPanel() With {.Dock = DockStyle.Fill, .FlowDirection = FlowDirection.LeftToRight}
            depthPanel.Controls.Add(New System.Windows.Forms.Label() With {.Text = "MaxDepth:", .AutoSize = True, .Padding = New Padding(0, 8, 0, 0)})
            depthPanel.Controls.Add(numMaxDepth)
            top.Controls.Add(depthPanel, 6, 1)

            top.Controls.Add(lblStatus, 7, 1)
            top.SetColumnSpan(lblStatus, 2)

            top.Controls.Add(pbar, 9, 1)

            Dim body As New SplitContainer() With {
                .Dock = DockStyle.Fill,
                .Orientation = Orientation.Vertical,
                .SplitterDistance = 380
            }

            Dim left As New GroupBox() With {.Text = "RVT 파일 목록", .Dock = DockStyle.Fill}
            lstFiles.Dock = DockStyle.Fill
            left.Controls.Add(lstFiles)
            body.Panel1.Controls.Add(left)

            Dim right As New GroupBox() With {.Text = "결과", .Dock = DockStyle.Fill}
            dgv.Dock = DockStyle.Fill
            dgv.ReadOnly = True
            dgv.AllowUserToAddRows = False
            dgv.AllowUserToDeleteRows = False
            dgv.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.DisplayedCells
            dgv.SelectionMode = DataGridViewSelectionMode.FullRowSelect
            dgv.MultiSelect = True

            right.Controls.Add(dgv)
            body.Panel2.Controls.Add(right)

            root.Controls.Add(top, 0, 0)
            root.Controls.Add(body, 0, 1)

            Controls.Add(root)

            btnExport.Enabled = False
        End Sub

        Private Sub OnAddFiles(sender As Object, e As EventArgs)
            Using ofd As New OpenFileDialog()
                ofd.Filter = "Revit Project (*.rvt)|*.rvt"
                ofd.Multiselect = True
                ofd.Title = "스캔할 RVT 파일 선택"
                If ofd.ShowDialog(Me) <> DialogResult.OK Then Return

                Dim existing As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase)
                For Each it As Object In lstFiles.Items
                    existing.Add(CStr(it))
                Next

                For Each p As String In ofd.FileNames
                    If File.Exists(p) AndAlso Not existing.Contains(p) Then
                        lstFiles.Items.Add(p)
                        existing.Add(p)
                    End If
                Next
            End Using
        End Sub

        Private Sub OnRemoveSelected(sender As Object, e As EventArgs)
            Dim selected As New List(Of Object)()
            For Each it As Object In lstFiles.SelectedItems
                selected.Add(it)
            Next
            For Each it As Object In selected
                lstFiles.Items.Remove(it)
            Next
        End Sub

        Private Sub OnClearFiles(sender As Object, e As EventArgs)
            lstFiles.Items.Clear()
        End Sub

        Private Sub SetBusy(isBusy As Boolean, status As String)
            btnAdd.Enabled = Not isBusy
            btnRemove.Enabled = Not isBusy
            btnClear.Enabled = Not isBusy
            btnScan.Enabled = Not isBusy
            btnClose.Enabled = Not isBusy

            chkOnlyImportant.Enabled = Not isBusy
            chkIncludeTypeSelection.Enabled = Not isBusy
            chkRecursive.Enabled = Not isBusy
            numMaxDepth.Enabled = (Not isBusy AndAlso chkRecursive.Checked)

            lblStatus.Text = status

            If isBusy Then
                pbar.Style = ProgressBarStyle.Marquee
                pbar.MarqueeAnimationSpeed = 30
            Else
                pbar.Style = ProgressBarStyle.Blocks
                pbar.MarqueeAnimationSpeed = 0
                pbar.Value = 0
            End If

            System.Windows.Forms.Application.DoEvents()
        End Sub

        Private Sub OnScan(sender As Object, e As EventArgs)
            If lstFiles.Items.Count = 0 Then
                MessageBox.Show(Me, "먼저 RVT 파일을 목록에 추가하세요.", "알림", MessageBoxButtons.OK, MessageBoxIcon.Information)
                Return
            End If

            Dim paths As New List(Of String)()
            For Each it As Object In lstFiles.Items
                paths.Add(CStr(it))
            Next

            Dim onlyImportant As Boolean = chkOnlyImportant.Checked
            Dim includeTypeSel As Boolean = chkIncludeTypeSelection.Checked
            Dim recursive As Boolean = chkRecursive.Checked
            Dim maxDepth As Integer = CInt(numMaxDepth.Value)

            SetBusy(True, "스캔 중... (문서/패밀리 여는 동안 잠시 멈춘 것처럼 보일 수 있음)")

            Dim results As List(Of AuditRow) = Nothing
            Try
                results = AuditFiles(_uiapp, paths, onlyImportant, includeTypeSel, recursive, maxDepth)
            Catch ex As Exception
                SetBusy(False, "오류")
                MessageBox.Show(Me, ex.ToString(), "스캔 오류", MessageBoxButtons.OK, MessageBoxIcon.Error)
                Return
            End Try

            _rows = results

            dgv.DataSource = Nothing
            dgv.DataSource = New BindingList(Of AuditRow)(_rows)

            btnExport.Enabled = (_rows IsNot Nothing AndAlso _rows.Count > 0)

            ' ✅ VB: _rows.Count(Function...) 금지 → LINQ로 변경
            Dim cntOk As Integer = _rows.Where(Function(r) r.Issue = AuditIssueType.OK.ToString()).Count()
            Dim cntMiss As Integer = _rows.Where(Function(r) r.Issue = AuditIssueType.MissingAssociation.ToString()).Count()
            Dim cntSus As Integer = _rows.Where(Function(r) r.Issue = AuditIssueType.SuspiciousAssociation.ToString()).Count()
            Dim cntConf As Integer = _rows.Where(Function(r) r.Issue = AuditIssueType.SharedTypeDrivenConflict.ToString()).Count()
            Dim cntErr As Integer = _rows.Where(Function(r) r.Issue = AuditIssueType.[Error].ToString()).Count()

            SetBusy(False, $"완료: {paths.Count}개 RVT / Rows={_rows.Count} (OK {cntOk}, Missing {cntMiss}, Sus {cntSus}, Conflict {cntConf}, Err {cntErr})")
        End Sub

        Private Sub OnExport(sender As Object, e As EventArgs)
            If _rows Is Nothing OrElse _rows.Count = 0 Then
                MessageBox.Show(Me, "저장할 결과가 없습니다.", "알림", MessageBoxButtons.OK, MessageBoxIcon.Information)
                Return
            End If

            Using sfd As New SaveFileDialog()
                sfd.Filter = "CSV (*.csv)|*.csv"
                sfd.Title = "결과 CSV 저장"
                sfd.FileName = "NestedFamilyParamAudit.csv"
                If sfd.ShowDialog(Me) <> DialogResult.OK Then Return

                Try
                    WriteCsv(sfd.FileName, _rows)
                    MessageBox.Show(Me, "저장 완료: " & sfd.FileName, "완료", MessageBoxButtons.OK, MessageBoxIcon.Information)
                Catch ex As Exception
                    MessageBox.Show(Me, ex.ToString(), "저장 오류", MessageBoxButtons.OK, MessageBoxIcon.Error)
                End Try
            End Using
        End Sub

        ' -------------------------
        ' Core Audit
        ' -------------------------
        Private Shared Function AuditFiles(uiapp As UIApplication,
                                           paths As List(Of String),
                                           onlyImportant As Boolean,
                                           includeTypeSelection As Boolean,
                                           recursive As Boolean,
                                           maxDepth As Integer) As List(Of AuditRow)

            Dim rows As New List(Of AuditRow)()

            For Each path As String In paths
                Dim doc As Document = Nothing
                Try
                    doc = OpenProjectDocument(uiapp.Application, path)

                    Dim visited As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase)
                    AuditProjectDocument(doc, path, onlyImportant, includeTypeSelection, recursive, maxDepth, rows, visited)

                Catch ex As Exception
                    rows.Add(New AuditRow With {
                        .ProjectPath = path,
                        .Issue = AuditIssueType.[Error].ToString(),
                        .Notes = "Project open/scan error: " & ex.Message
                    })
                Finally
                    If doc IsNot Nothing Then
                        Try
                            doc.Close(False)
                        Catch
                        End Try
                    End If
                End Try
            Next

            Return rows
        End Function

        Private Shared Sub AuditProjectDocument(doc As Document,
                                               projectPath As String,
                                               onlyImportant As Boolean,
                                               includeTypeSelection As Boolean,
                                               recursive As Boolean,
                                               maxDepth As Integer,
                                               rows As List(Of AuditRow),
                                               visited As HashSet(Of String))

            Dim fams As IEnumerable(Of Family) =
                New FilteredElementCollector(doc).
                    OfClass(GetType(Family)).
                    Cast(Of Family)()

            For Each fam As Family In fams
                If fam Is Nothing Then Continue For
                If Not fam.IsEditable Then Continue For
                If fam.IsInPlace Then Continue For

                AuditFamilyAsHost(doc, fam, projectPath, onlyImportant, includeTypeSelection, recursive, maxDepth, 1, rows, visited)
            Next
        End Sub

        Private Shared Sub AuditFamilyAsHost(hostDoc As Document,
                                             hostFamily As Family,
                                             projectPath As String,
                                             onlyImportant As Boolean,
                                             includeTypeSelection As Boolean,
                                             recursive As Boolean,
                                             maxDepth As Integer,
                                             depth As Integer,
                                             rows As List(Of AuditRow),
                                             visited As HashSet(Of String))

            Dim hostKey As String = $"{projectPath}||{hostFamily.Name}||Depth{depth}"
            If visited.Contains(hostKey) Then Return
            visited.Add(hostKey)

            Dim famDoc As Document = Nothing
            Try
                famDoc = hostDoc.EditFamily(hostFamily)
                If famDoc Is Nothing OrElse Not famDoc.IsFamilyDocument Then Return

                Dim nestedInstances As List(Of FamilyInstance) =
                    New FilteredElementCollector(famDoc).
                        OfClass(GetType(FamilyInstance)).
                        WhereElementIsNotElementType().
                        Cast(Of FamilyInstance)().
                        ToList()

                If nestedInstances.Count = 0 Then Return

                Dim hostCat As String = ""
                Try
                    If hostFamily.FamilyCategory IsNot Nothing Then hostCat = hostFamily.FamilyCategory.Name
                Catch
                End Try

                For Each fi As FamilyInstance In nestedInstances
                    If fi Is Nothing Then Continue For
                    If fi.Symbol Is Nothing Then Continue For
                    If fi.Symbol.Family Is Nothing Then Continue For

                    Dim nestedFam As Family = fi.Symbol.Family
                    Dim nestedIsShared As Boolean = IsFamilyShared(nestedFam)

                    Dim nestedCat As String = ""
                    Try
                        If fi.Category IsNot Nothing Then nestedCat = fi.Category.Name
                    Catch
                    End Try

                    Dim paramTuples As List(Of Tuple(Of Parameter, ParamScope)) = CollectParams(fi, includeTypeSelection)

                    For Each t As Tuple(Of Parameter, ParamScope) In paramTuples
                        Dim p As Parameter = t.Item1
                        Dim scope As ParamScope = t.Item2

                        If Not ShouldInspect(p, scope, onlyImportant) Then Continue For

                        Dim assoc As FamilyParameter = Nothing
                        Try
                            assoc = famDoc.FamilyManager.GetAssociatedFamilyParameter(p)
                        Catch ex As Exception
                            rows.Add(New AuditRow With {
                                .ProjectPath = projectPath,
                                .HostFamilyName = hostFamily.Name,
                                .HostFamilyCategory = hostCat,
                                .NestedFamilyName = nestedFam.Name,
                                .NestedTypeName = SafeStr(fi.Symbol.Name),
                                .NestedCategory = nestedCat,
                                .NestedIsShared = nestedIsShared,
                                .NestedParamScope = scope.ToString(),
                                .NestedParamName = SafeParamName(p),
                                .NestedParamType = SafeParamTypeName(p),
                                .Issue = AuditIssueType.[Error].ToString(),
                                .Notes = "GetAssociatedFamilyParameter failed: " & ex.Message
                            })
                            Continue For
                        End Try

                        Dim issue As AuditIssueType = AuditIssueType.OK
                        Dim notes As String = ""

                        If assoc Is Nothing Then
                            issue = AuditIssueType.MissingAssociation
                            notes = "호스트 패밀리 파라미터로 연동(Associate)되지 않음"
                        Else
                            If scope = ParamScope.InstanceParam AndAlso Not assoc.IsInstance Then
                                issue = AuditIssueType.SuspiciousAssociation
                                notes = "인스턴스 파라미터가 호스트 타입 파라미터로 연결된 것으로 보임(의도 확인)"
                            ElseIf scope = ParamScope.TypeParam AndAlso assoc.IsInstance Then
                                issue = AuditIssueType.SuspiciousAssociation
                                notes = "타입 파라미터가 호스트 인스턴스 파라미터로 연결된 것으로 보임(의도 확인)"
                            End If

                            Dim ptNested As ParameterType = SafeGetParameterType(p)
                            Dim ptHost As ParameterType = SafeGetParameterType(assoc)
                            If ptNested <> ParameterType.Invalid AndAlso ptHost <> ParameterType.Invalid AndAlso ptNested <> ptHost Then
                                issue = AuditIssueType.SuspiciousAssociation
                                If notes <> "" Then notes &= " / "
                                notes &= $"파라미터 타입 불일치({ptNested} -> {ptHost})"
                            End If

                            If nestedIsShared AndAlso (scope = ParamScope.TypeSelection) Then
                                If ptHost = ParameterType.FamilyType Then
                                    issue = AuditIssueType.SharedTypeDrivenConflict
                                    notes = "Shared 네스티드 패밀리는 호스트에서 타입(FamilyType) 구동이 제한/불가할 수 있음"
                                End If
                            End If
                        End If

                        Dim row As New AuditRow With {
                            .ProjectPath = projectPath,
                            .HostFamilyName = hostFamily.Name,
                            .HostFamilyCategory = hostCat,
                            .NestedFamilyName = nestedFam.Name,
                            .NestedTypeName = SafeStr(fi.Symbol.Name),
                            .NestedCategory = nestedCat,
                            .NestedIsShared = nestedIsShared,
                            .NestedParamScope = scope.ToString(),
                            .NestedParamName = SafeParamName(p),
                            .NestedParamType = SafeParamTypeName(p),
                            .Issue = issue.ToString(),
                            .Notes = notes
                        }

                        If assoc IsNot Nothing Then
                            row.AssocHostParamName = SafeStr(assoc.Definition.Name)
                            row.AssocHostParamIsInstance = assoc.IsInstance.ToString()
                            row.AssocHostParamIsShared = assoc.IsShared.ToString()
                            row.AssocHostParamIsReporting = SafeBoolToString(SafeIsReporting(assoc))
                            row.AssocHostParamFormula = SafeStr(SafeGetFormula(assoc))
                        End If

                        rows.Add(row)
                    Next

                    If recursive AndAlso depth < maxDepth Then
                        If nestedFam IsNot Nothing AndAlso nestedFam.IsEditable AndAlso Not nestedFam.IsInPlace Then
                            AuditFamilyAsHost(famDoc, nestedFam, projectPath, onlyImportant, includeTypeSelection, True, maxDepth, depth + 1, rows, visited)
                        End If
                    End If
                Next

            Finally
                If famDoc IsNot Nothing Then
                    Try
                        famDoc.Close(False)
                    Catch
                    End Try
                End If
            End Try
        End Sub

        Private Shared Function OpenProjectDocument(app As Autodesk.Revit.ApplicationServices.Application, path As String) As Document
            If String.IsNullOrWhiteSpace(path) Then Throw New ArgumentException("path is empty.")
            If Not File.Exists(path) Then Throw New FileNotFoundException("RVT not found.", path)

            Dim mp As ModelPath = ModelPathUtils.ConvertUserVisiblePathToModelPath(path)

            Dim opts As New OpenOptions()
            opts.Audit = False

            Try
                opts.DetachFromCentralOption = DetachFromCentralOption.DetachAndPreserveWorksets
            Catch
            End Try

            Try
                Dim ws As New WorksetConfiguration(WorksetConfigurationOption.CloseAllWorksets)
                opts.SetOpenWorksetsConfiguration(ws)
            Catch
            End Try

            Try
                Return app.OpenDocumentFile(mp, opts)
            Catch
                Dim opts2 As New OpenOptions()
                opts2.Audit = False
                Try
                    Dim ws2 As New WorksetConfiguration(WorksetConfigurationOption.CloseAllWorksets)
                    opts2.SetOpenWorksetsConfiguration(ws2)
                Catch
                End Try
                Return app.OpenDocumentFile(mp, opts2)
            End Try
        End Function

        Private Shared Function CollectParams(fi As FamilyInstance, includeTypeSelection As Boolean) As List(Of Tuple(Of Parameter, ParamScope))
            Dim list As New List(Of Tuple(Of Parameter, ParamScope))()
            Dim seen As New HashSet(Of String)(StringComparer.OrdinalIgnoreCase)

            Try
                For Each p As Parameter In fi.Parameters
                    If p Is Nothing OrElse p.Definition Is Nothing Then Continue For
                    Dim key As String = "I|" & p.Definition.Name
                    If seen.Add(key) Then list.Add(Tuple.Create(p, ParamScope.InstanceParam))
                Next
            Catch
            End Try

            Try
                If fi.Symbol IsNot Nothing Then
                    For Each p As Parameter In fi.Symbol.Parameters
                        If p Is Nothing OrElse p.Definition Is Nothing Then Continue For
                        Dim key As String = "T|" & p.Definition.Name
                        If seen.Add(key) Then list.Add(Tuple.Create(p, ParamScope.TypeParam))
                    Next
                End If
            Catch
            End Try

            If includeTypeSelection Then
                Try
                    ' ✅ VB/Revit: get_Parameter 대신 Parameter(...)
                    Dim pType As Parameter = fi.Parameter(BuiltInParameter.ELEM_TYPE_PARAM)
                    If pType IsNot Nothing AndAlso pType.Definition IsNot Nothing Then
                        Dim key As String = "TS|" & pType.Definition.Name
                        If seen.Add(key) Then list.Add(Tuple.Create(pType, ParamScope.TypeSelection))
                    End If
                Catch
                End Try
            End If

            Return list
        End Function

        Private Shared Function ShouldInspect(p As Parameter, scope As ParamScope, onlyImportant As Boolean) As Boolean
            If p Is Nothing OrElse p.Definition Is Nothing Then Return False
            If p.IsReadOnly Then Return False

            If scope = ParamScope.TypeSelection Then Return True
            If Not onlyImportant Then Return True

            Dim pt As ParameterType = ParameterType.Invalid
            Try
                pt = p.Definition.ParameterType
            Catch
            End Try

            Select Case pt
                Case ParameterType.Length,
                     ParameterType.Angle,
                     ParameterType.YesNo,
                     ParameterType.Material,
                     ParameterType.Number,
                     ParameterType.Integer,
                     ParameterType.Text,
                     ParameterType.Area,
                     ParameterType.Volume
                    Return True
            End Select

            Dim n As String = SafeStr(p.Definition.Name)
            If String.IsNullOrWhiteSpace(n) Then Return False

            Dim rx As New Regex("(width|height|depth|thick|offset|elev|level|diam|radius|slope|angle|visib|visible|material|mat|length|len)", RegexOptions.IgnoreCase)
            If rx.IsMatch(n) Then Return True

            Dim rxKr As New Regex("(폭|너비|가로|세로|높이|깊이|두께|오프셋|레벨|표고|지름|반지름|경사|각도|가시|표시|재질|길이)", RegexOptions.IgnoreCase)
            If rxKr.IsMatch(n) Then Return True

            Return False
        End Function

        Private Shared Function IsFamilyShared(fam As Family) As Boolean
            If fam Is Nothing Then Return False
            Try
                ' ✅ VB/Revit: get_Parameter 대신 Parameter(...)
                Dim p As Parameter = fam.Parameter(BuiltInParameter.FAMILY_SHARED)
                If p IsNot Nothing AndAlso p.StorageType = StorageType.Integer Then
                    Return p.AsInteger() = 1
                End If
            Catch
            End Try
            Return False
        End Function

        Private Shared Function SafeParamName(p As Parameter) As String
            Try
                If p Is Nothing OrElse p.Definition Is Nothing Then Return ""
                Return SafeStr(p.Definition.Name)
            Catch
                Return ""
            End Try
        End Function

        Private Shared Function SafeParamTypeName(p As Parameter) As String
            Try
                If p Is Nothing OrElse p.Definition Is Nothing Then Return ""
                Return p.Definition.ParameterType.ToString()
            Catch
                Return ""
            End Try
        End Function

        Private Shared Function SafeGetParameterType(p As Parameter) As ParameterType
            Try
                If p Is Nothing OrElse p.Definition Is Nothing Then Return ParameterType.Invalid
                Return p.Definition.ParameterType
            Catch
                Return ParameterType.Invalid
            End Try
        End Function

        Private Shared Function SafeGetParameterType(fp As FamilyParameter) As ParameterType
            Try
                If fp Is Nothing OrElse fp.Definition Is Nothing Then Return ParameterType.Invalid
                Return fp.Definition.ParameterType
            Catch
                Return ParameterType.Invalid
            End Try
        End Function

        Private Shared Function SafeIsReporting(fp As FamilyParameter) As Boolean
            Try
                Return fp.IsReporting
            Catch
                Return False
            End Try
        End Function

        Private Shared Function SafeGetFormula(fp As FamilyParameter) As String
            Try
                If fp.IsDeterminedByFormula Then
                    Return fp.Formula
                End If
            Catch
            End Try
            Return ""
        End Function

        Private Shared Function SafeBoolToString(v As Boolean) As String
            Return If(v, "True", "False")
        End Function

        Private Shared Function SafeStr(s As String) As String
            Return If(s, "")
        End Function

        Private Shared Sub WriteCsv(path As String, rows As List(Of AuditRow))
            Dim headers As String() = {
                "ProjectPath",
                "HostFamilyName", "HostFamilyCategory",
                "NestedFamilyName", "NestedTypeName", "NestedCategory", "NestedIsShared",
                "NestedParamScope", "NestedParamName", "NestedParamType",
                "AssocHostParamName", "AssocHostParamIsInstance", "AssocHostParamIsShared", "AssocHostParamIsReporting", "AssocHostParamFormula",
                "Issue", "Notes"
            }

            Using fs As New FileStream(path, FileMode.Create, FileAccess.Write, FileShare.Read)
                Using sw As New StreamWriter(fs, New UTF8Encoding(True))
                    sw.WriteLine(String.Join(",", headers.Select(Function(h) CsvEscape(h))))

                    For Each r As AuditRow In rows
                        Dim cols As New List(Of String) From {
                            r.ProjectPath,
                            r.HostFamilyName, r.HostFamilyCategory,
                            r.NestedFamilyName, r.NestedTypeName, r.NestedCategory, r.NestedIsShared.ToString(),
                            r.NestedParamScope, r.NestedParamName, r.NestedParamType,
                            r.AssocHostParamName, r.AssocHostParamIsInstance, r.AssocHostParamIsShared, r.AssocHostParamIsReporting, r.AssocHostParamFormula,
                            r.Issue, r.Notes
                        }
                        sw.WriteLine(String.Join(",", cols.Select(Function(c) CsvEscape(c))))
                    Next
                End Using
            End Using
        End Sub

        Private Shared Function CsvEscape(s As String) As String
            If s Is Nothing Then s = ""
            Dim needsQuotes As Boolean = s.Contains(","c) OrElse s.Contains(""""c) OrElse s.Contains(vbCr) OrElse s.Contains(vbLf)
            s = s.Replace("""", """""")
            If needsQuotes Then
                Return """" & s & """"
            End If
            Return s
        End Function

    End Class

End Namespace
