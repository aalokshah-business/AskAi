using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class AskAI {
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
    internal static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"").TrimEnd('\\') + "\""; }
    internal static ProcessStartInfo StartInfo(string exe, string args) {
        return new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
    }
    [STAThread]
    private static int Main(string[] args) {
        string ready = args.Length > 3 ? args[3] : null;
        try {
            if (args.Length > 0 && args[0] == "--self-test") { Application.EnableVisualStyles(); using (var window = new AskWindow(args[1], args[2], Path.GetTempPath())) window.SelfTest(); Console.WriteLine("Native form, required fields, file picker and multiline copy passed."); return 0; }
            if (args.Length > 0 && (args[0] == "--install-shortcuts" || args[0] == "--remove-shortcuts")) { Shortcuts(args[1], args[2], args[0] == "--remove-shortcuts", args.Length > 3 ? args[3] : null); return 0; }
            if (args.Length > 0 && args[0] == "--ocr") {
                string text = Recognize(args[1]);
                if (String.IsNullOrWhiteSpace(text)) throw new Exception("No text recognized. Check image quality and Windows OCR language packs.");
                using (var file = new FileStream(args[2], FileMode.CreateNew, FileAccess.Write))
                using (var writer = new StreamWriter(file, new UTF8Encoding(false))) writer.Write("# " + Path.GetFileName(args[1]) + "\n\n" + text + "\n");
                return 0;
            }
            if (args.Length < 2) throw new Exception("Open Ask AI using its installed shortcut or askai desktop.");
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            var form = new AskWindow(args[0], args[1], args.Length > 2 ? args[2] : Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
            if (!String.IsNullOrEmpty(ready)) form.Shown += delegate { File.WriteAllText(ready, "{\"ok\":true}"); };
            Application.Run(form); return 0;
        } catch (Exception error) {
            if (!String.IsNullOrEmpty(ready) && args[0] != "--install-shortcuts" && args[0] != "--remove-shortcuts") File.WriteAllText(ready, Json.Serialize(new { ok = false, error = error.Message }));
            if (args.Length > 0 && args[0].StartsWith("--")) Console.Error.WriteLine(error.Message);
            else MessageBox.Show(error.Message, "Ask AI could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    // Resolve OS-provided WinRT metadata at runtime; installing the Windows SDK is unnecessary.
    private static Type WinType(string name) { return Type.GetType(name + ", Windows, ContentType=WindowsRuntime", true); }
    private static object Call(Type type, object instance, string name, params object[] values) {
        var method = type.GetMethods().First(m => m.Name == name && m.GetParameters().Length == values.Length);
        return method.Invoke(instance, values);
    }
    private static object Await(object operation, Type resultType) {
        var extensions = Assembly.LoadFrom(Path.Combine(System.Runtime.InteropServices.RuntimeEnvironment.GetRuntimeDirectory(), "System.Runtime.WindowsRuntime.dll")).GetType("System.WindowsRuntimeSystemExtensions", true);
        var method = extensions.GetMethods().First(m => m.Name == "AsTask" && m.IsGenericMethod && m.GetGenericArguments().Length == 1 && m.GetParameters().Length == 1);
        var task = (Task)method.MakeGenericMethod(resultType).Invoke(null, new object[] { operation });
        task.GetAwaiter().GetResult(); return task.GetType().GetProperty("Result").GetValue(task, null);
    }
    private static string Recognize(string source) {
        var storage = WinType("Windows.Storage.StorageFile");
        var file = Await(Call(storage, null, "GetFileFromPathAsync", Path.GetFullPath(source)), storage);
        var streamType = WinType("Windows.Storage.Streams.IRandomAccessStream");
        var stream = Await(Call(storage, file, "OpenAsync", Enum.ToObject(WinType("Windows.Storage.FileAccessMode"), 0)), streamType);
        object bitmap = null;
        try {
            var decoderType = WinType("Windows.Graphics.Imaging.BitmapDecoder");
            var decoder = Await(Call(decoderType, null, "CreateAsync", stream), decoderType);
            var bitmapType = WinType("Windows.Graphics.Imaging.SoftwareBitmap");
            bitmap = Await(Call(decoderType, decoder, "GetSoftwareBitmapAsync", Enum.ToObject(WinType("Windows.Graphics.Imaging.BitmapPixelFormat"), 87), Enum.ToObject(WinType("Windows.Graphics.Imaging.BitmapAlphaMode"), 0)), bitmapType);
            var engineType = WinType("Windows.Media.Ocr.OcrEngine");
            var engine = Call(engineType, null, "TryCreateFromUserProfileLanguages");
            if (engine == null) throw new Exception("Install a Windows OCR language pack first.");
            uint max = (uint)engineType.GetProperty("MaxImageDimension").GetValue(null, null);
            if ((int)bitmapType.GetProperty("PixelWidth").GetValue(bitmap, null) > max || (int)bitmapType.GetProperty("PixelHeight").GetValue(bitmap, null) > max) throw new Exception("Image exceeds Windows OCR dimensions; resize it first.");
            var resultType = WinType("Windows.Media.Ocr.OcrResult");
            var result = Await(Call(engineType, engine, "RecognizeAsync", bitmap), resultType);
            var lines = (System.Collections.IEnumerable)resultType.GetProperty("Lines").GetValue(result, null);
            var text = new List<string>(); foreach (object line in lines) text.Add(Convert.ToString(line.GetType().GetProperty("Text").GetValue(line, null)));
            return String.Join("\n", text);
        } finally { if (bitmap is IDisposable) ((IDisposable)bitmap).Dispose(); if (stream is IDisposable) ((IDisposable)stream).Dispose(); }
    }
    private static object Property(object obj, string name) { return obj.GetType().InvokeMember(name, BindingFlags.GetProperty, null, obj, null); }
    private static void Set(object obj, string name, object value) { obj.GetType().InvokeMember(name, BindingFlags.SetProperty, null, obj, new object[] { value }); }
    private static void Shortcuts(string root, string node, bool remove, string testFolder) {
        var shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        var folders = String.IsNullOrEmpty(testFolder) ? new[] { Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), Environment.GetFolderPath(Environment.SpecialFolder.Programs) } : new[] { testFolder };
        var links = new List<KeyValuePair<string, object>>();
        foreach (string folder in folders.Where(f => !String.IsNullOrEmpty(f))) {
            string file = Path.Combine(folder, "Ask AI.lnk");
            if (remove && !File.Exists(file)) continue;
            var link = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { file });
            if (File.Exists(file) && Convert.ToString(Property(link, "Description")) != "Ask AI managed desktop launcher") throw new Exception("Preserved unrelated shortcut: " + file);
            links.Add(new KeyValuePair<string, object>(file, link));
        }
        foreach (var item in links) {
            if (remove) { File.Delete(item.Key); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(item.Key));
            Set(item.Value, "TargetPath", Assembly.GetExecutingAssembly().Location);
            Set(item.Value, "Arguments", Quote(root) + " " + Quote(node));
            Set(item.Value, "WorkingDirectory", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
            Set(item.Value, "Description", "Ask AI managed desktop launcher");
            item.Value.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, item.Value, null);
        }
    }
}

internal sealed class AskWindow : Form {
    private readonly string root, node;
    private readonly TextBox project = new TextBox(), source = new TextBox(), folder = new TextBox(), output = new TextBox();
    private readonly ComboBox commands = new ComboBox(), actions = new ComboBox(), helpCommands = new ComboBox(), environments = new ComboBox();
    private readonly RowStyle tabSize = new RowStyle(SizeType.Absolute,220);
    private TabControl tabs;
    private Panel commandOutput;
    private GroupBox outputGroup;
    private TableLayoutPanel windowLayout;
    private RowStyle outputSize, summarySize;
    private TableLayoutPanel selector;
    private Label actionCaption;
    private RowStyle actionRow;
    private Control conversionContent, helpContent;
    private string lastCommand = "status", lastHelpCommand = "status";
    private static readonly string[] CategoryOrder = { "work", "project", "setup", "health", "cost", "learn", "system", "more" };
    private static readonly Dictionary<string, string> CategoryLabel = new Dictionary<string, string> { { "work", "WORK" }, { "project", "PROJECT" }, { "setup", "SETUP" }, { "health", "HEALTH" }, { "cost", "COST & LEVERS" }, { "learn", "LEARN" }, { "system", "SYSTEM" }, { "more", "MORE" } };
    private Dictionary<string, string> ReadTheme() { return AskAI.Json.Deserialize<Dictionary<string, string>>(File.ReadAllText(Path.Combine(root, "standalone", "desktop-theme.json"))); }
    private static void FillCombo(ComboBox box, IEnumerable<Dictionary<string, object>> catalog) {
        foreach (var cat in CategoryOrder) {
            var inCat = catalog.Where(c => TextOf(c, "category") == cat).ToArray();
            if (inCat.Length == 0) continue;
            box.Items.Add("── " + CategoryLabel[cat] + " ──");
            foreach (var entry in inCat) box.Items.Add(entry["name"]);
        }
    }
    private TableLayoutPanel ArgumentRow(){var row=new TableLayoutPanel{AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,Dock=DockStyle.None,ColumnCount=2,Margin=Padding.Empty,Padding=new Padding(4,2,4,6)};row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));row.RowStyles.Add(new RowStyle(SizeType.AutoSize));row.RowStyles.Add(new RowStyle(SizeType.AutoSize));row.RowStyles.Add(new RowStyle(SizeType.AutoSize));return row;}
    private void SetCaption(TableLayoutPanel row, string text){var label=new Label{Text=text,AutoSize=true,Anchor=AnchorStyles.Left,Margin=new Padding(4,4,4,0),MaximumSize=new Size(280,0)};row.Controls.Add(label,0,0);row.SetColumnSpan(label,2);}
    private void SetHint(TableLayoutPanel row, string hint){if(String.IsNullOrWhiteSpace(hint))return;var label=new Label{Text=hint,AutoSize=true,ForeColor=Color.FromArgb(86,96,138),Margin=new Padding(4,0,4,2),MaximumSize=new Size(280,0),Font=new Font(Font.FontFamily,8f)};row.Controls.Add(label,0,2);row.SetColumnSpan(label,2);}
    private readonly Label commandInfo = new Label(), status = new Label();
    private readonly FlowLayoutPanel fieldsPanel = new FlowLayoutPanel(), optionsPanel = new FlowLayoutPanel();
    private readonly Dictionary<string, Control> fields = new Dictionary<string, Control>();
    private readonly List<OptionRow> optionRows = new List<OptionRow>();
    private readonly Button convert = new Button(), run = new Button(), help = new Button(), stop = new Button(), open = new Button(), openFolder = new Button(), chooseFile = new Button();
    private readonly RadioButton fileMode = new RadioButton(), urlMode = new RadioButton(), folderMode = new RadioButton();
    private readonly Dictionary<string, object>[] catalog;
    private bool convertOnly;
    private Dictionary<string, object>[] variants;
    private Process job; private string lastOutput; private bool closing;
    private sealed class OptionRow { internal string Flag; internal Control Value; internal Panel Panel; }
    private static IEnumerable<Dictionary<string, object>> Objects(object value) { return ((System.Collections.IEnumerable)value).Cast<object>().Select(o => (Dictionary<string, object>)o); }
    private static string TextOf(Dictionary<string, object> row, string key) { return row.ContainsKey(key) ? Convert.ToString(row[key]) : ""; }
    private static bool Required(Dictionary<string, object> row) { return row.ContainsKey("required") && Convert.ToBoolean(row["required"]); }
    private Dictionary<string, object> SelectedVariant { get { return variants[Math.Max(0, actions.SelectedIndex)]; } }
    private Dictionary<string,object> EnvironmentForm { get { return (Dictionary<string,object>)SelectedVariant["environment"]; } }
    private IEnumerable<Dictionary<string,object>> VisibleOptions { get { return Objects(SelectedVariant["options"]).Where(o=>TextOf(o,"flag")!=TextOf(EnvironmentForm,"flag")); } }
    private IEnumerable<Dictionary<string,object>> VisibleFields { get { var hidden=((System.Collections.IEnumerable)EnvironmentForm["hiddenFields"]).Cast<object>().Select(Convert.ToString);return Objects(SelectedVariant["positionals"]).Where(f=>TextOf(f,"name")!=TextOf(EnvironmentForm,"field")&&!hidden.Contains(TextOf(f,"name"))); } }
    private void FitTab() {
        if (tabs == null) return;
        bool commandTab = tabs.SelectedIndex == 1 && commandOutput != null && outputGroup != null;
        if (commandTab) {
            if (outputGroup.Parent != commandOutput) { windowLayout.Controls.Remove(outputGroup); commandOutput.Controls.Add(outputGroup); outputGroup.Dock = DockStyle.Fill; }
            tabSize.SizeType = SizeType.Percent; tabSize.Height = 100;
            outputSize.SizeType = SizeType.Absolute; outputSize.Height = 0;
            if (summarySize != null) { summarySize.SizeType = SizeType.AutoSize; commandInfo.Visible = true; }
        } else if (outputGroup != null && windowLayout != null) {
            if (outputGroup.Parent != windowLayout) { commandOutput.Controls.Remove(outputGroup); windowLayout.Controls.Add(outputGroup, 0, 3); }
            tabSize.SizeType = SizeType.Absolute;
            Control content = tabs.SelectedIndex == 2 ? helpContent : tabs.SelectedIndex == 0 ? conversionContent : null;
            tabSize.Height = content != null ? content.GetPreferredSize(new Size(Math.Max(300, tabs.ClientSize.Width - 8), 0)).Height + 32 : (tabs.SelectedIndex == 2 ? 112 : 218);
            outputSize.SizeType = SizeType.Percent; outputSize.Height = 100;
            if (summarySize != null) { summarySize.SizeType = SizeType.Absolute; summarySize.Height = 0; commandInfo.Visible = false; }
        }
        if (selector != null) {
            int width = selector.ClientSize.Width > 40 ? selector.ClientSize.Width - SystemInformation.VerticalScrollBarWidth : 440;
            fieldsPanel.Width = optionsPanel.Width = width;
            foreach (Control row in fieldsPanel.Controls.Cast<Control>().Concat(optionsPanel.Controls.Cast<Control>())) { row.Width = width; row.MaximumSize = new Size(width, 0); if ((row.Tag as string) == "beside") continue; foreach (Label label in row.Controls.OfType<Label>()) label.MaximumSize = new Size(Math.Max(80, width - 16), 0); }
            if (commandInfo != null) commandInfo.MaximumSize = new Size(Math.Max(200, ClientSize.Width - 48), 0);
        }
    }
    private string EnvironmentValue(){if(environments.SelectedIndex<=0)return "";return TextOf(Objects(EnvironmentForm["choices"]).ElementAt(environments.SelectedIndex-1),"value");}
    internal static string Multiline(string value) { return System.Text.RegularExpressions.Regex.Replace(value ?? "", "\\r\\n|\\r|\\n", "\r\n"); }
    internal static void CopyText(string value, Action<string> clipboard) { if (!String.IsNullOrEmpty(value)) clipboard(value); }
    private static Button Button(string text, EventHandler handler) { var button = new Button { Text = text, AutoSize = true, MinimumSize = new Size(100, 30), Margin = new Padding(4) }; if (handler != null) button.Click += handler; return button; }
    private static TableLayoutPanel Table(int columns) { return new TableLayoutPanel { AutoSize = true, Dock = DockStyle.Top, ColumnCount = columns, Padding = new Padding(6) }; }
    private static void Label(TableLayoutPanel table, string text, int column, int row, bool bold = false) { var label = new Label { Text = text, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(4, 8, 8, 8) }; if (bold) label.Font = new Font(label.Font, FontStyle.Bold); table.Controls.Add(label, column, row); }
    private void Browse(Control target, bool directory) {
        if (directory) { using (var dialog = new FolderBrowserDialog { SelectedPath = project.Text }) if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.SelectedPath; }
        else using (var dialog = new OpenFileDialog { Filter = "All files|*.*" }) if (dialog.ShowDialog(this) == DialogResult.OK) target.Text = dialog.FileName;
    }
    private static bool Beside(Dictionary<string, object> definition) { return TextOf(definition, "picker").Length == 0 && TextOf(definition, "hint").Length == 0 && !definition.ContainsKey("suggestions") && (TextOf(definition, "kind") == "boolean" || definition.ContainsKey("choices")); }
    private TableLayoutPanel BesideRow() { var row = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.None, ColumnCount = 2, Margin = Padding.Empty, Padding = new Padding(4, 1, 4, 1), Tag = "beside" }; row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); row.RowStyles.Add(new RowStyle(SizeType.AutoSize)); return row; }
    private void AddPicker(TableLayoutPanel row, Control target, Dictionary<string, object> definition) {
        string picker = TextOf(definition, "picker");
        if (picker != "folder" && picker != "file") return;
        row.Controls.Add(Button(picker == "folder" ? "Choose Folder" : "Choose File", delegate { Browse(target, picker == "folder"); }), 1, 1);
    }
    private Control Input(Dictionary<string, object> definition) {
        if (TextOf(definition, "kind") == "boolean") { var boolean = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList }; boolean.Items.AddRange(new object[] { "true", "false" }); boolean.SelectedIndex = 1; return boolean; }
        if (definition.ContainsKey("choices")) { var combo = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList }; foreach (object value in (System.Collections.IEnumerable)definition["choices"]) combo.Items.Add(value); return combo; }
        if (definition.ContainsKey("suggestions")) {
            // Unlike "choices" above, this field also accepts free text (e.g. ask's fuzzy search
            // query): DropDown, not DropDownList, plus autocomplete from the same list.
            var combo = new ComboBox { DropDownStyle = ComboBoxStyle.DropDown, AutoCompleteMode = AutoCompleteMode.SuggestAppend, AutoCompleteSource = AutoCompleteSource.ListItems };
            foreach (object value in (System.Collections.IEnumerable)definition["suggestions"]) combo.Items.Add(value);
            return combo;
        }
        return new TextBox();
    }
    private void RefreshForm() {
        fieldsPanel.Controls.Clear(); fields.Clear(); optionsPanel.Controls.Clear(); optionRows.Clear();
        string previous=environments.Text;environments.Items.Clear();environments.Items.Add(TextOf(EnvironmentForm,"defaultLabel"));foreach(var choice in Objects(EnvironmentForm["choices"]))environments.Items.Add(choice["label"]);environments.Enabled=Convert.ToBoolean(EnvironmentForm["supported"]);environments.SelectedIndex=environments.Items.Contains(previous)?environments.Items.IndexOf(previous):0;
        Action<Dictionary<string, object>, string, bool, FlowLayoutPanel> add = (definition, caption, option, panel) => {
            bool beside = Beside(definition);
            var row = beside ? BesideRow() : ArgumentRow();
            var control = Input(definition); control.Dock = DockStyle.Fill; control.Margin = new Padding(4, 2, 4, 2);
            if (beside) { var label = new Label { Text = caption, AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(4, 6, 8, 4) }; row.Controls.Add(label, 0, 0); row.Controls.Add(control, 1, 0); }
            else { SetCaption(row, caption); row.Controls.Add(control, 0, 1); AddPicker(row, control, definition); SetHint(row, TextOf(definition, "hint")); }
            if (option) optionRows.Add(new OptionRow { Panel = row, Flag = TextOf(definition, "flag"), Value = control });
            else fields[TextOf(definition, "name")] = control;
            panel.Controls.Add(row);
        };
        foreach (var field in VisibleFields.Where(Beside)) add(field, TextOf(field, "label") + (Required(field) ? " *" : " (Optional)"), false, fieldsPanel);
        foreach (var option in VisibleOptions.Where(Beside)) add(option, "--" + TextOf(option, "flag") + (Required(option) ? " *" : ""), true, fieldsPanel);
        foreach (var field in VisibleFields.Where(field => !Beside(field))) add(field, TextOf(field, "label") + (Required(field) ? " *" : " (Optional)"), false, optionsPanel);
        foreach (var option in VisibleOptions.Where(option => !Beside(option))) add(option, "--" + TextOf(option, "flag") + (Required(option) ? " *" : ""), true, optionsPanel);
        FitTab();if(IsHandleCreated)ApplyTheme();
    }
    // A blank optional argument is not sent. A boolean is sent only when it is true, so a listed
    // --dry-run stays off until the user turns it on.
    private bool IncludeOption(Dictionary<string, object> option, Control value) {
        string text = ControlValue(value);
        if (TextOf(option, "kind") == "boolean") return text == "true";
        if (Required(option)) return true;
        return !String.IsNullOrWhiteSpace(text);
    }
    // DropDownList .Text can stay on the first item ("true") after SelectedItem is set, which turned
    // update's dry-run row on and printed the preview instead of updating.
    private static string ControlValue(Control control) { var box = control as ComboBox; if (box != null && box.DropDownStyle == ComboBoxStyle.DropDownList) return Convert.ToString(box.SelectedItem ?? box.Text); return control.Text; }
    private Dictionary<string, object> CommandRequest() {
        var values = fields.ToDictionary(item => item.Key, item => (object)ControlValue(item.Value));
        var options = optionRows.Where(row => IncludeOption(VisibleOptions.First(option => TextOf(option, "flag") == row.Flag), row.Value)).Select(row => new Dictionary<string, object> { { "flag", row.Flag }, { "value", ControlValue(row.Value) } }).ToArray();
        return new Dictionary<string, object> { { "kind", "command" }, { "command", Convert.ToString(commands.SelectedItem) }, { "variant", SelectedVariant["id"] }, { "environment",EnvironmentValue() }, { "fields", values }, { "options", options } };
    }
    internal AskWindow(string appRoot, string nodePath, string projectPath) {
        root = appRoot; node = nodePath; Text = "Ask AI"; Size = new Size(1040, Math.Min(920, Screen.PrimaryScreen.WorkingArea.Height - 30)); MinimumSize = new Size(900, 650); StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10);
        // /win32icon on the compiled exe already sets Explorer/taskbar/Alt-Tab; this also covers a titlebar that
        // for any reason falls back to the process default instead of the exe's own icon.
        try { var iconPath = Path.Combine(root, "standalone", "askai.ico"); if (File.Exists(iconPath)) Icon = new Icon(iconPath); } catch { /* keep the default icon */ }
        using (var process = Process.Start(AskAI.StartInfo(node, AskAI.Quote(Path.Combine(root,"standalone","desktop-bridge.js")) + " --catalog"))) {
            string json = process.StandardOutput.ReadToEnd(), error = process.StandardError.ReadToEnd(); process.WaitForExit(); if (process.ExitCode != 0) throw new Exception(error); catalog = AskAI.Json.Deserialize<Dictionary<string, object>[]>(json);
        }
        // askai install --convert-only (just the desktop app and markitdown): open straight to Convert To Markdown
        // and grey out Commands/Help, since there is no Claude Code/Codex/Antigravity/Cursor setup for them to touch.
        try {
            using (var modeProcess = Process.Start(AskAI.StartInfo(node, AskAI.Quote(Path.Combine(root,"standalone","desktop-bridge.js")) + " --mode"))) {
                string modeJson = modeProcess.StandardOutput.ReadToEnd(); modeProcess.WaitForExit();
                if (modeProcess.ExitCode == 0) convertOnly = Convert.ToBoolean(AskAI.Json.Deserialize<Dictionary<string, object>>(modeJson)["convertOnly"]);
            }
        } catch { /* best-effort: a failed check just leaves every tab enabled */ }
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 6, Padding = new Padding(14) }; windowLayout = layout; Controls.Add(layout); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        outputSize = new RowStyle(SizeType.Percent, 100); summarySize = new RowStyle(SizeType.Absolute, 0);
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(tabSize); layout.RowStyles.Add(outputSize); layout.RowStyles.Add(summarySize); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var header = new Panel { Dock = DockStyle.Fill, Height = 64, Margin = new Padding(0,0,0,10) };
        header.Paint += delegate (object s, PaintEventArgs e) {
            var t = ReadTheme(); e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var navy = new System.Drawing.Drawing2D.LinearGradientBrush(header.ClientRectangle, ColorTranslator.FromHtml(t["navy"]), ColorTranslator.FromHtml(t["teal"]), 20f)) e.Graphics.FillRectangle(navy, header.ClientRectangle);
            using (var accent = new SolidBrush(ColorTranslator.FromHtml(t["teal"]))) e.Graphics.FillEllipse(accent, 14, 12, 40, 40);
            using (var white = new SolidBrush(Color.White)) {
                e.Graphics.DrawString("AI", new Font("Segoe UI", 13, FontStyle.Bold), white, new RectangleF(14, 12, 40, 40), new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
                e.Graphics.DrawString("Ask AI", new Font("Segoe UI", 20, FontStyle.Bold), white, new PointF(66, 8));
            }
            using (var sub = new SolidBrush(ColorTranslator.FromHtml(t["secondary"]))) e.Graphics.DrawString("Commands, conversion and output, in one window", new Font("Segoe UI", 9.5f), sub, new PointF(66, 36));
        };
        layout.Controls.Add(header,0,0);
        var projectRow = Table(3); projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); Label(projectRow,"Project Folder",0,0); project.Dock=DockStyle.Fill; project.Text=Directory.Exists(projectPath)?projectPath:Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); projectRow.Controls.Add(project,1,0); projectRow.Controls.Add(Button("Browse...",delegate{Browse(project,true);}),2,0); layout.Controls.Add(projectRow,0,1);
        tabs = new TabControl { Dock=DockStyle.Fill, Appearance=TabAppearance.FlatButtons, Padding=new Point(12,3) }; var conversion = new TabPage("Convert To Markdown"); var command = new TabPage("Command"); var helpTab = new TabPage("Help"); tabs.TabPages.Add(conversion); tabs.TabPages.Add(command); tabs.TabPages.Add(helpTab); layout.Controls.Add(tabs,0,2);
        if (convertOnly) { command.Enabled = false; tabs.SelectedTab = conversion; }
        var conversionLayout=Table(3);conversionContent=conversionLayout; conversionLayout.Dock=DockStyle.Fill; conversionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,170)); conversionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); conversionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); conversion.Controls.Add(conversionLayout);
        var modes=new FlowLayoutPanel{AutoSize=true,Dock=DockStyle.Fill}; fileMode.Text="Local File";urlMode.Text="YouTube / Web URL";folderMode.Text="Local Folder";fileMode.AutoSize=urlMode.AutoSize=folderMode.AutoSize=true;modes.Controls.Add(fileMode);modes.Controls.Add(urlMode);modes.Controls.Add(folderMode);conversionLayout.Controls.Add(modes,1,0);Label(conversionLayout,"Input type",0,0,true);
        Label(conversionLayout,"File / URL / Folder *",0,1,true);source.Dock=DockStyle.Fill;conversionLayout.Controls.Add(source,1,1);chooseFile.Text="Choose File...";chooseFile.AutoSize=true;chooseFile.Click+=delegate{if(folderMode.Checked){Browse(source,true);}else using(var dialog=new OpenFileDialog{Filter="Documents and images|*.pdf;*.docx;*.pptx;*.xlsx;*.xls;*.png;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff;*.html;*.csv;*.txt;*.md|All files|*.*"})if(dialog.ShowDialog(this)==DialogResult.OK){source.Text=dialog.FileName;folder.Text=Path.GetDirectoryName(dialog.FileName);}};conversionLayout.Controls.Add(chooseFile,2,1);
        EventHandler modeChanged=delegate{source.ReadOnly=!urlMode.Checked;chooseFile.Visible=fileMode.Checked||folderMode.Checked;chooseFile.Text=folderMode.Checked?"Choose Folder...":"Choose File...";source.Clear();};
        fileMode.CheckedChanged+=modeChanged;urlMode.CheckedChanged+=modeChanged;folderMode.CheckedChanged+=modeChanged;fileMode.Checked=true;
        if(convertOnly)urlMode.Enabled=false;
        Label(conversionLayout,"Output Folder",0,2,true);folder.Dock=DockStyle.Fill;conversionLayout.Controls.Add(folder,1,2);conversionLayout.Controls.Add(Button("Browse...",delegate{Browse(folder,true);}),2,2);
        convert.Text="Convert";convert.AutoSize=true;convert.Click+=async delegate{await Work(new Dictionary<string,object>{{"kind","convert"},{"source",source.Text.Trim()},{"folder",folder.Text.Trim()}});};conversionLayout.Controls.Add(convert,1,3);
        var note=new Label{Text="Local extraction/OCR. A blank output folder uses the file's folder, or the project for a URL. Existing files stay.\nYouTube needs captions. A folder converts the files inside it only, not subfolders.",AutoSize=true,Dock=DockStyle.Top,Font=new Font(Font.FontFamily,8.25f)};conversionLayout.Controls.Add(note,1,4);conversionLayout.SetColumnSpan(note,2);
        var commandSplit=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1};commandSplit.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,340));commandSplit.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));commandSplit.RowStyles.Add(new RowStyle(SizeType.Percent,100));command.Controls.Add(commandSplit);
        var commandLayout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3};commandLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));commandLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));commandLayout.RowStyles.Add(new RowStyle(SizeType.Percent,100));commandLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));commandSplit.Controls.Add(commandLayout,0,0);
        commandOutput=new Panel{Dock=DockStyle.Fill};commandSplit.Controls.Add(commandOutput,1,0);
        var selection=new TableLayoutPanel{AutoSize=true,Dock=DockStyle.Top,ColumnCount=2,Padding=new Padding(6)};selector=selection;selection.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,110));selection.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));selection.RowStyles.Add(new RowStyle(SizeType.AutoSize));actionRow=new RowStyle(SizeType.AutoSize);selection.RowStyles.Add(actionRow);selection.RowStyles.Add(new RowStyle(SizeType.AutoSize));commands.DropDownStyle=actions.DropDownStyle=environments.DropDownStyle=ComboBoxStyle.DropDownList;commands.Dock=actions.Dock=environments.Dock=DockStyle.Fill;Label(selection,"Command",0,0,true);commands.AccessibleName="Command";selection.Controls.Add(commands,1,0);actionCaption=new Label{Text="Action",AutoSize=true,Anchor=AnchorStyles.Left,Margin=new Padding(4,8,8,8)};actionCaption.Font=new Font(actionCaption.Font,FontStyle.Bold);selection.Controls.Add(actionCaption,0,1);actions.AccessibleName="Action";selection.Controls.Add(actions,1,1);Label(selection,"Environment",0,2,true);environments.AccessibleName="Environment";selection.Controls.Add(environments,1,2);commandInfo.AutoSize=true;commandInfo.Font=new Font(Font.FontFamily,8f);commandInfo.Margin=new Padding(0,2,0,0);commandInfo.Dock=DockStyle.Top;commandInfo.Visible=false;commandLayout.Controls.Add(selection,0,0);
        var scroll=new Panel{AutoScroll=true,Dock=DockStyle.Fill};var formStack=new FlowLayoutPanel{FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoSize=true,Dock=DockStyle.Top};scroll.Controls.Add(formStack);fieldsPanel.FlowDirection=optionsPanel.FlowDirection=FlowDirection.TopDown;fieldsPanel.WrapContents=optionsPanel.WrapContents=false;fieldsPanel.AutoSize=optionsPanel.AutoSize=true;fieldsPanel.Margin=optionsPanel.Margin=Padding.Empty;formStack.Margin=Padding.Empty;formStack.Controls.Add(new Label{Text="Arguments",AutoSize=true,Font=new Font(Font,FontStyle.Bold),Margin=new Padding(8,8,0,2)});formStack.Controls.Add(fieldsPanel);formStack.Controls.Add(optionsPanel);commandLayout.Controls.Add(scroll,0,1);
        var commandButtons=new FlowLayoutPanel{AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,Dock=DockStyle.Top,WrapContents=false,FlowDirection=FlowDirection.LeftToRight,Padding=new Padding(2,0,2,2)};run.Text="Run";help.Text="Help";run.AutoSize=help.AutoSize=true;run.MinimumSize=help.MinimumSize=new Size(0,26);run.Margin=help.Margin=new Padding(2);run.Padding=help.Padding=new Padding(10,2,10,2);run.Click+=async delegate{await Work(CommandRequest());};help.Click+=async delegate{await Work(new Dictionary<string,object>{{"kind","command"},{"command","help"},{"args","command "+commands.SelectedItem}});};var openTerminal=Button("Open Terminal",delegate{try{Process.Start(new ProcessStartInfo(node,AskAI.Quote(Path.Combine(root,"askai.js"))+" cli"){WorkingDirectory=project.Text,UseShellExecute=true});}catch(Exception e){status.Text=e.Message;}});openTerminal.MinimumSize=new Size(0,26);openTerminal.Margin=new Padding(2);openTerminal.Padding=new Padding(8,2,8,2);commandButtons.Controls.Add(run);commandButtons.Controls.Add(help);commandButtons.Controls.Add(openTerminal);commandLayout.Controls.Add(commandButtons,0,2);
        commands.SelectedIndexChanged+=delegate{var name=Convert.ToString(commands.SelectedItem);var entry=catalog.FirstOrDefault(c=>TextOf(c,"name")==name);if(entry==null){commands.SelectedItem=lastCommand;return;}lastCommand=name;commandInfo.Text=TextOf(entry,"summary");variants=Objects(entry["variants"]).ToArray();actions.Items.Clear();foreach(var definition in variants)actions.Items.Add(TextOf(definition,"label"));actions.SelectedIndex=0;bool many=variants.Length>1;actionCaption.Visible=actions.Visible=many;actionRow.SizeType=many?SizeType.AutoSize:SizeType.Absolute;if(!many)actionRow.Height=0;};actions.SelectedIndexChanged+=delegate{if(actions.SelectedIndex>=0)RefreshForm();};FillCombo(commands,catalog);commands.SelectedItem="status";
        var helpLayout=Table(3);helpContent=helpLayout;helpLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));helpLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));helpLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));helpTab.Controls.Add(helpLayout);Label(helpLayout,"Command",0,0,true);helpCommands.DropDownStyle=ComboBoxStyle.DropDownList;helpCommands.Dock=DockStyle.Fill;helpCommands.AccessibleName="Help Command";FillCombo(helpCommands,catalog);helpCommands.SelectedItem="status";helpLayout.Controls.Add(helpCommands,1,0);EventHandler showHelp=async delegate{await Work(new Dictionary<string,object>{{"kind","command"},{"command","help"},{"args","command "+helpCommands.SelectedItem+" --advanced"}});};helpLayout.Controls.Add(Button("Show Detailed Help",showHelp),2,0);helpCommands.SelectedIndexChanged+=delegate{var name=Convert.ToString(helpCommands.SelectedItem);if(!catalog.Any(c=>TextOf(c,"name")==name)){helpCommands.SelectedItem=lastHelpCommand;return;}lastHelpCommand=name;if(tabs.SelectedTab==helpTab)showHelp(null,EventArgs.Empty);};tabs.SelectedIndexChanged+=delegate{open.Visible=openFolder.Visible=tabs.SelectedTab==conversion;FitTab();if(tabs.SelectedTab==helpTab && Visible)showHelp(null,EventArgs.Empty);};
        output.AccessibleName="Output";output.Multiline=true;output.ReadOnly=true;output.WordWrap=true;output.ScrollBars=ScrollBars.Vertical;output.Font=new Font("Consolas",10);output.Dock=DockStyle.Fill;output.Text="Ready. Choose a file or URL, or select a command.\r\nNo command or source analysis runs on startup.";outputGroup=new GroupBox{Text="Output",Dock=DockStyle.Fill};outputGroup.Controls.Add(output);layout.Controls.Add(outputGroup,0,3);
        var resultRow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Margin=new Padding(0,10,0,0)};resultRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));resultRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        var resultButtons=new FlowLayoutPanel{AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,WrapContents=false,FlowDirection=FlowDirection.LeftToRight,Anchor=AnchorStyles.Left};resultButtons.Controls.Add(Button("Copy Output",delegate{try{CopyText(output.Text,Clipboard.SetText);status.Text="Output copied.";}catch(Exception e){status.Text="Clipboard unavailable: "+e.Message;}}));stop.Text="Stop";open.Text="Open Markdown";openFolder.Text="Open Folder";stop.AutoSize=open.AutoSize=openFolder.AutoSize=true;stop.Enabled=open.Enabled=openFolder.Enabled=false;stop.Click+=delegate{StopJob();};open.Click+=delegate{if(lastOutput!=null)Process.Start("notepad.exe",AskAI.Quote(lastOutput));};openFolder.Click+=delegate{if(lastOutput!=null)Process.Start("explorer.exe",AskAI.Quote(Path.GetDirectoryName(lastOutput)));};resultButtons.Controls.Add(stop);resultButtons.Controls.Add(open);resultButtons.Controls.Add(openFolder);resultRow.Controls.Add(resultButtons,0,0);
        status.AutoSize=true;status.Text="Ready";status.Dock=DockStyle.Fill;status.TextAlign=ContentAlignment.MiddleRight;status.Margin=new Padding(12,10,4,4);resultRow.Controls.Add(status,1,0);layout.Controls.Add(commandInfo,0,4);layout.Controls.Add(resultRow,0,5);
        ApplyTheme();Resize+=delegate{FitTab();};FitTab();
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(job!=null&&!job.HasExited){if(MessageBox.Show(this,"Stop the running operation and close Ask AI?","Ask AI",MessageBoxButtons.YesNo)!=DialogResult.Yes){e.Cancel=true;return;}closing=true;StopJob();}};
    }
    private void ApplyTheme(){
        var theme=AskAI.Json.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(root,"standalone","desktop-theme.json")));
        Func<string,Color> color=key=>ColorTranslator.FromHtml(theme[key]);
        Action<Control> apply=null;apply=control=>{
            bool input=control is TextBox||control is ComboBox;control.ForeColor=color("text");control.BackColor=input?color("surface"):color("background");
            if(control!=output&&control.Font.FontFamily.Name!=theme["font"])control.Font=new Font(theme["font"],control.Font.Size,control.Font.Style);
            var button=control as Button;if(button!=null){button.FlatStyle=FlatStyle.Flat;button.FlatAppearance.BorderColor=color("border");button.BackColor=color("secondary");button.ForeColor=color("accent");if(button==run||button==convert){button.BackColor=color("accent");button.ForeColor=color("surface");}}
            var combo=control as ComboBox;if(combo!=null)combo.FlatStyle=FlatStyle.Flat;
            var group=control as GroupBox;if(group!=null){group.ForeColor=color("teal");group.Font=new Font(theme["font"],10,FontStyle.Bold);}
            if(control==status)control.ForeColor=color("teal");
            if(control==commandInfo)control.ForeColor=color("muted");
            foreach(Control child in control.Controls)apply(child);
        };apply(this);BackColor=color("background");if(output.Font.FontFamily.Name!=theme["monospace"])output.Font=new Font(theme["monospace"],10);output.BackColor=color("surface");
        if(tabs.DrawMode!=TabDrawMode.OwnerDrawFixed){tabs.DrawMode=TabDrawMode.OwnerDrawFixed;tabs.DrawItem+=delegate(object sender,DrawItemEventArgs e){bool active=e.Index==tabs.SelectedIndex;int top=e.Bounds.Y;for(int i=0;i<tabs.TabCount;i++)top=Math.Min(top,tabs.GetTabRect(i).Y);var rect=new Rectangle(e.Bounds.X,top,e.Bounds.Width,Math.Max(16,e.Bounds.Height-(e.Bounds.Y-top)));using(var clear=new SolidBrush(color("background")))e.Graphics.FillRectangle(clear,e.Bounds);using(var brush=new SolidBrush(color(active?"background":"secondary")))e.Graphics.FillRectangle(brush,rect);TextRenderer.DrawText(e.Graphics,tabs.TabPages[e.Index].Text,tabs.Font,rect,color(active?"accent":"text"),TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter);};}
    }
    private void StopJob(){try{if(job!=null&&!job.HasExited)Process.Start(new ProcessStartInfo("taskkill.exe","/pid "+job.Id+" /t /f"){UseShellExecute=false,CreateNoWindow=true});}catch(Exception e){status.Text=e.Message;}}
    private async Task Work(Dictionary<string,object> request){
        if(job!=null)return;if(!Directory.Exists(project.Text)){MessageBox.Show(this,"Choose an existing project folder.","Ask AI");return;}string file=Path.Combine(Path.GetTempPath(),"askai-desktop-"+Guid.NewGuid().ToString("N")+".json");
        try{request["project"]=project.Text;File.WriteAllText(file,AskAI.Json.Serialize(request),new UTF8Encoding(false));var info=AskAI.StartInfo(node,AskAI.Quote(Path.Combine(root,"standalone","desktop-bridge.js"))+" "+AskAI.Quote(file));info.WorkingDirectory=project.Text;job=Process.Start(info);run.Enabled=convert.Enabled=help.Enabled=helpCommands.Enabled=false;stop.Enabled=true;open.Enabled=openFolder.Enabled=false;lastOutput=null;status.Text="Running...";output.Text="Working...";
            Task<string> stdout=job.StandardOutput.ReadToEndAsync(),stderr=job.StandardError.ReadToEndAsync();await Task.WhenAll(stdout,stderr);job.WaitForExit();if(closing)return;if(String.IsNullOrWhiteSpace(stdout.Result))throw new Exception("No result. "+stderr.Result);var result=AskAI.Json.Deserialize<Dictionary<string,object>>(stdout.Result);output.Text=Multiline(result.ContainsKey("display")?Convert.ToString(result["display"]):String.Join("\n",new[]{TextOf(result,"stdout"),TextOf(result,"stderr"),stderr.Result}));status.Text="Finished: exit "+result["code"];if(result.ContainsKey("output")&&result["output"]!=null){lastOutput=Convert.ToString(result["output"]);open.Enabled=openFolder.Enabled=true;}
        }catch(Exception e){if(!closing){output.Text=e.Message;status.Text="Failed";}}finally{if(File.Exists(file))File.Delete(file);if(job!=null)job.Dispose();job=null;if(!closing){run.Enabled=convert.Enabled=help.Enabled=helpCommands.Enabled=true;stop.Enabled=false;}}
    }
    internal void SelfTest(){
        int groups=catalog.Select(c=>TextOf(c,"category")).Distinct().Count();if(helpCommands.Items.Count!=catalog.Length+groups||commands.Items.Count!=catalog.Length+groups)throw new Exception("Help Catalog Missing");
        if(!convertOnly){
            // Commands is disabled in convert-only mode (asserted below), which in WinForms disables every
            // control inside that TabPage too -- Control.Enabled reads false once any ancestor is disabled, even
            // though the control's own flag is still true. None of this section is reachable by a user then, so
            // none of it is meaningful to exercise. Help stays enabled (it only reads static text, see below).
            foreach(var entry in catalog){commands.SelectedItem=entry["name"];for(int index=0;index<variants.Length;index++){actions.SelectedIndex=index;if(fields.Count!=VisibleFields.Count())throw new Exception("Command fields missing: "+entry["name"]);if(optionRows.Count!=VisibleOptions.Count())throw new Exception("Command arguments missing: "+entry["name"]);foreach(var required in VisibleOptions.Where(Required))if(!optionRows.Any(row=>row.Flag==TextOf(required,"flag")))throw new Exception("Required option missing");}}
            commands.SelectedItem="why";if(fields.Count!=1)throw new Exception("Required command field missing");
            commands.SelectedItem="start";if(optionRows.Count!=VisibleOptions.Count()||!environments.Enabled)throw new Exception("Required options missing");
            commands.SelectedItem="mcp";actions.SelectedIndex=variants.Select(v=>TextOf(v,"label")).ToList().IndexOf("confirm");if(fields.Count!=1||optionRows.Count!=VisibleOptions.Count())throw new Exception("MCP confirm fields missing");
            commands.SelectedItem="update";var dry=optionRows.First(row=>row.Flag=="dry-run");if(ControlValue(dry.Value)!="false")throw new Exception("Auto-shown boolean option must default to false, not silently enable --dry-run");if(((System.Collections.IEnumerable)CommandRequest()["options"]).Cast<Dictionary<string,object>>().Any(row=>TextOf(row,"flag")=="dry-run"))throw new Exception("Dry-run must stay off until chosen");
            commands.SelectedItem="status";if(actions.Visible)throw new Exception("Single-action command still shows Action");
            commands.SelectedItem="mcp";if(!actions.Visible)throw new Exception("Multi-action command hides Action");
            commands.SelectedItem="project";if(!fieldsPanel.Controls.Cast<Control>().SelectMany(row=>row.Controls.OfType<Button>()).Any(button=>button.Text=="Choose Folder"))throw new Exception("Directory argument has no folder picker");
            commands.SelectedItem="start";if(!optionsPanel.Controls.Cast<Control>().SelectMany(row=>row.Controls.OfType<Button>()).Any(button=>button.Text=="Choose Folder"))throw new Exception("Repo argument has no folder picker");
            commands.SelectedItem="ask";if(fields.Count!=1)throw new Exception("Ask field missing");var askField=fields.Values.First() as ComboBox;if(askField==null||askField.DropDownStyle!=ComboBoxStyle.DropDown||askField.Items.Count==0)throw new Exception("Ask suggestions dropdown missing or locked to exact matches");askField.Text="free text search, not in the list";if(askField.Text!="free text search, not in the list")throw new Exception("Ask field must still accept free text");
            tabs.SelectedIndex=1;FitTab();if(outputGroup.Parent!=commandOutput||tabSize.SizeType!=SizeType.Percent)throw new Exception("Command output is not on the right");tabs.SelectedIndex=2;FitTab();if(outputGroup.Parent!=windowLayout||tabSize.SizeType!=SizeType.Absolute||tabSize.Height>200)throw new Exception("Help Tab Wastes Output Space");tabs.SelectedIndex=0;FitTab();if(outputGroup.Parent!=windowLayout)throw new Exception("Convert output left the shared pane");
        }
        string copied=null;CopyText(Multiline("first\nsecond\n\nthird"),s=>copied=s);if(copied!="first\r\nsecond\r\n\r\nthird")throw new Exception("Multiline copy failed");if(chooseFile.Parent==null||!fileMode.Checked||!source.ReadOnly)throw new Exception("File picker missing");
        folderMode.Checked=true;if(!source.ReadOnly||chooseFile.Text!="Choose Folder...")throw new Exception("Folder picker missing");
        if(!convertOnly){urlMode.Checked=true;if(source.ReadOnly)throw new Exception("URL mode should allow typing");}
        fileMode.Checked=true;
        if(tabs.TabPages[1].Enabled==convertOnly)throw new Exception("Commands enabled state does not match detected convert-only mode");
        if(!tabs.TabPages[2].Enabled)throw new Exception("Help must stay enabled in convert-only mode: it only reads static help text, nothing project-specific");
        if(convertOnly&&tabs.SelectedTab!=tabs.TabPages[0])throw new Exception("Convert-only mode should open on Convert To Markdown");
        if(urlMode.Enabled==convertOnly)throw new Exception("YouTube/Web URL enabled state does not match detected convert-only mode");
        }
}
