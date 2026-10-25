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
        return new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
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
    private TableLayoutPanel selector;
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
    private TableLayoutPanel ArgumentRow(){var row=Table(3);row.AutoSize=false;row.Dock=DockStyle.None;row.Height=42;row.Margin=Padding.Empty;row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.33f));row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.33f));row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.34f));return row;}
    private readonly Label commandInfo = new Label(), status = new Label();
    private readonly FlowLayoutPanel fieldsPanel = new FlowLayoutPanel(), optionsPanel = new FlowLayoutPanel();
    private readonly Dictionary<string, Control> fields = new Dictionary<string, Control>();
    private readonly List<OptionRow> optionRows = new List<OptionRow>();
    private readonly Button convert = new Button(), run = new Button(), help = new Button(), stop = new Button(), open = new Button(), openFolder = new Button(), chooseFile = new Button(), addOption = new Button();
    private readonly RadioButton fileMode = new RadioButton(), urlMode = new RadioButton();
    private readonly Dictionary<string, object>[] catalog;
    private Dictionary<string, object>[] variants;
    private Process job; private string lastOutput; private bool closing;
    private sealed class OptionRow { internal ComboBox Flag; internal Control Value; internal Button Remove; internal Panel Panel; }
    private static IEnumerable<Dictionary<string, object>> Objects(object value) { return ((System.Collections.IEnumerable)value).Cast<object>().Select(o => (Dictionary<string, object>)o); }
    private static string TextOf(Dictionary<string, object> row, string key) { return row.ContainsKey(key) ? Convert.ToString(row[key]) : ""; }
    private static bool Required(Dictionary<string, object> row) { return row.ContainsKey("required") && Convert.ToBoolean(row["required"]); }
    private Dictionary<string, object> SelectedVariant { get { return variants[Math.Max(0, actions.SelectedIndex)]; } }
    private Dictionary<string,object> EnvironmentForm { get { return (Dictionary<string,object>)SelectedVariant["environment"]; } }
    private IEnumerable<Dictionary<string,object>> VisibleOptions { get { return Objects(SelectedVariant["options"]).Where(o=>TextOf(o,"flag")!=TextOf(EnvironmentForm,"flag")); } }
    private IEnumerable<Dictionary<string,object>> VisibleFields { get { var hidden=((System.Collections.IEnumerable)EnvironmentForm["hiddenFields"]).Cast<object>().Select(Convert.ToString);return Objects(SelectedVariant["positionals"]).Where(f=>TextOf(f,"name")!=TextOf(EnvironmentForm,"field")&&!hidden.Contains(TextOf(f,"name"))); } }
    private void FitTab(){if(tabs==null)return;Control content=tabs.SelectedIndex==2?helpContent:tabs.SelectedIndex==0?conversionContent:null;tabSize.Height=content!=null?content.GetPreferredSize(new Size(Math.Max(300,tabs.ClientSize.Width-8),0)).Height+32:tabs.SelectedIndex==2?112:tabs.SelectedIndex==0?218:Math.Min(Math.Max(160,160+fields.Count*42+optionRows.Count*42),Math.Max(200,Math.Min(340,ClientSize.Height/2)));if(selector!=null){int width=Math.Max(400,selector.Width-SystemInformation.VerticalScrollBarWidth);fieldsPanel.Width=optionsPanel.Width=width;foreach(Control row in fieldsPanel.Controls)row.Width=width;foreach(Control row in optionsPanel.Controls)row.Width=width;}}
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
    private Control Input(Dictionary<string, object> definition) {
        if (TextOf(definition, "kind") == "boolean") { var boolean = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList }; boolean.Items.AddRange(new object[] { "true", "false" }); boolean.SelectedIndex = 0; return boolean; }
        if (definition.ContainsKey("choices")) { var combo = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList }; foreach (object value in (System.Collections.IEnumerable)definition["choices"]) combo.Items.Add(value); return combo; }
        return new TextBox();
    }
    private void RefreshForm() {
        fieldsPanel.Controls.Clear(); fields.Clear(); optionsPanel.Controls.Clear(); optionRows.Clear();
        string previous=environments.Text;environments.Items.Clear();environments.Items.Add(TextOf(EnvironmentForm,"defaultLabel"));foreach(var choice in Objects(EnvironmentForm["choices"]))environments.Items.Add(choice["label"]);environments.Enabled=Convert.ToBoolean(EnvironmentForm["supported"]);environments.SelectedIndex=environments.Items.Contains(previous)?environments.Items.IndexOf(previous):0;
        foreach (var field in VisibleFields) {
            var row = ArgumentRow();
            Label(row, TextOf(field, "label") + (Required(field) ? " *" : " (Optional)"), 0, 0);
            var control = Input(field); control.Dock = DockStyle.Fill; row.Controls.Add(control, 1, 0); fields[TextOf(field, "name")] = control;
            string name = TextOf(field, "name"); if (name.Contains("path") || name.Contains("directory") || name.Contains("file")) row.Controls.Add(Button("Browse...", delegate { Browse(control, name.Contains("directory") || name.Contains("path")); }), 2, 0);
            fieldsPanel.Controls.Add(row);
        }
        foreach (var option in VisibleOptions.Where(Required)) AddOption(TextOf(option, "flag"));
        if (Convert.ToString(commands.SelectedItem) == "status" && VisibleOptions.Any(o => TextOf(o,"flag") == "brief")) AddOption("brief");
        // Show the first optional argument row without waiting for Add Option, so selecting a command alone
        // reveals whether it has any optional arguments at all. A boolean defaults to false here (not
        // Input()'s usual "true"): this row appears on its own, not because the user asked to set the
        // flag, so it must not silently turn a behavior-changing option like --dry-run on.
        if (optionRows.Count == 0 && VisibleOptions.Any()) {
            var first = VisibleOptions.First();
            var added = AddOption(TextOf(first, "flag"));
            var vb = added == null ? null : added.Value as ComboBox;
            if (vb != null && TextOf(first, "kind") == "boolean") vb.SelectedItem = "false";
        }
        UpdateAddOptionEnabled();
        FitTab();if(IsHandleCreated)ApplyTheme();
    }
    private void UpdateAddOptionEnabled() { addOption.Enabled = VisibleOptions.Any(o => !optionRows.Any(r => Convert.ToString(r.Flag.SelectedItem) == TextOf(o, "flag"))); }
    private OptionRow AddOption(string initial = null) {
        var available = VisibleOptions.Where(o => !optionRows.Any(r => Convert.ToString(r.Flag.SelectedItem) == TextOf(o, "flag"))).ToArray();
        if (available.Length == 0) { status.Text = "All available options already added."; UpdateAddOptionEnabled(); return null; }
        var row = new OptionRow { Panel = ArgumentRow(), Flag = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock=DockStyle.Fill }, Remove = Button("Remove", null) };
        foreach (var option in VisibleOptions) row.Flag.Items.Add(TextOf(option, "flag"));
        ((TableLayoutPanel)row.Panel).Controls.Add(row.Flag,0,0);row.Remove.Anchor=AnchorStyles.Right;((TableLayoutPanel)row.Panel).Controls.Add(row.Remove,2,0);
        row.Flag.SelectedIndexChanged += delegate {
            if (row.Value != null) row.Panel.Controls.Remove(row.Value);
            var selected = Objects(SelectedVariant["options"]).First(o => TextOf(o,"flag") == Convert.ToString(row.Flag.SelectedItem));
            row.Value = Input(selected); row.Value.Dock=DockStyle.Fill;((TableLayoutPanel)row.Panel).Controls.Add(row.Value,1,0);
            bool mandatory = Required(selected); row.Remove.Enabled = !mandatory; row.Flag.Enabled = !mandatory;
            row.Remove.Text = mandatory ? "Required *" : "Remove";
        };
        row.Remove.Click += delegate { optionsPanel.Controls.Remove(row.Panel); optionRows.Remove(row); row.Panel.Dispose(); UpdateAddOptionEnabled(); FitTab(); };
        row.Flag.SelectedItem = initial ?? TextOf(available[0], "flag"); optionRows.Add(row); optionsPanel.Controls.Add(row.Panel); UpdateAddOptionEnabled(); FitTab();if(IsHandleCreated)ApplyTheme();
        return row;
    }
    private Dictionary<string, object> CommandRequest() {
        var values = fields.ToDictionary(item => item.Key, item => (object)item.Value.Text);
        var options = optionRows.Select(row => new Dictionary<string, object> { { "flag", Convert.ToString(row.Flag.SelectedItem) }, { "value", row.Value.Text } }).ToArray();
        return new Dictionary<string, object> { { "kind", "command" }, { "command", Convert.ToString(commands.SelectedItem) }, { "variant", SelectedVariant["id"] }, { "environment",EnvironmentValue() }, { "fields", values }, { "options", options } };
    }
    internal AskWindow(string appRoot, string nodePath, string projectPath) {
        root = appRoot; node = nodePath; Text = "Ask AI"; Size = new Size(1040, Math.Min(920, Screen.PrimaryScreen.WorkingArea.Height - 30)); MinimumSize = new Size(900, 650); StartPosition = FormStartPosition.CenterScreen; Font = new Font("Segoe UI", 10);
        using (var process = Process.Start(AskAI.StartInfo(node, AskAI.Quote(Path.Combine(root,"standalone","desktop-bridge.js")) + " --catalog"))) {
            string json = process.StandardOutput.ReadToEnd(), error = process.StandardError.ReadToEnd(); process.WaitForExit(); if (process.ExitCode != 0) throw new Exception(error); catalog = AskAI.Json.Deserialize<Dictionary<string, object>[]>(json);
        }
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 6, Padding = new Padding(14) }; Controls.Add(layout); layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(tabSize); layout.RowStyles.Add(new RowStyle(SizeType.Percent,100)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        var header = new Panel { Dock = DockStyle.Fill, Height = 64, Margin = new Padding(0,0,0,10) };
        header.Paint += delegate (object s, PaintEventArgs e) {
            var t = ReadTheme(); e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var navy = new SolidBrush(ColorTranslator.FromHtml(t["navy"]))) e.Graphics.FillRectangle(navy, header.ClientRectangle);
            using (var accent = new SolidBrush(ColorTranslator.FromHtml(t["accent"]))) e.Graphics.FillEllipse(accent, 14, 12, 40, 40);
            using (var white = new SolidBrush(Color.White)) {
                e.Graphics.DrawString("AI", new Font("Segoe UI", 13, FontStyle.Bold), white, new RectangleF(14, 12, 40, 40), new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
                e.Graphics.DrawString("Ask AI", new Font("Segoe UI", 20, FontStyle.Bold), white, new PointF(66, 8));
            }
            using (var sub = new SolidBrush(ColorTranslator.FromHtml(t["secondary"]))) e.Graphics.DrawString("Commands, conversion and output, in one window", new Font("Segoe UI", 9.5f), sub, new PointF(66, 36));
        };
        layout.Controls.Add(header,0,0);
        var projectRow = Table(3); projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); projectRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); Label(projectRow,"Project Folder",0,0); project.Dock=DockStyle.Fill; project.Text=Directory.Exists(projectPath)?projectPath:Environment.GetFolderPath(Environment.SpecialFolder.UserProfile); projectRow.Controls.Add(project,1,0); projectRow.Controls.Add(Button("Browse...",delegate{Browse(project,true);}),2,0); layout.Controls.Add(projectRow,0,1);
        tabs = new TabControl { Dock=DockStyle.Fill, Padding=new Point(22,8) }; var conversion = new TabPage("Convert To Markdown"); var command = new TabPage("Ask AI Commands"); var helpTab = new TabPage("Ask AI Help"); tabs.TabPages.Add(conversion); tabs.TabPages.Add(command); tabs.TabPages.Add(helpTab); layout.Controls.Add(tabs,0,2);
        var conversionLayout=Table(3);conversionContent=conversionLayout; conversionLayout.Dock=DockStyle.Fill; conversionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,170)); conversionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); conversionLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); conversion.Controls.Add(conversionLayout);
        var modes=new FlowLayoutPanel{AutoSize=true,Dock=DockStyle.Fill}; fileMode.Text="Local File";urlMode.Text="YouTube / Web URL";fileMode.AutoSize=urlMode.AutoSize=true;modes.Controls.Add(fileMode);modes.Controls.Add(urlMode);conversionLayout.Controls.Add(modes,1,0);Label(conversionLayout,"Input type",0,0,true);
        Label(conversionLayout,"File / URL *",0,1,true);source.Dock=DockStyle.Fill;conversionLayout.Controls.Add(source,1,1);chooseFile.Text="Choose File...";chooseFile.AutoSize=true;chooseFile.Click+=delegate{using(var dialog=new OpenFileDialog{Filter="Documents and images|*.pdf;*.docx;*.pptx;*.xlsx;*.xls;*.png;*.jpg;*.jpeg;*.bmp;*.tif;*.tiff;*.html;*.csv;*.txt;*.md|All files|*.*"})if(dialog.ShowDialog(this)==DialogResult.OK){source.Text=dialog.FileName;folder.Text=Path.GetDirectoryName(dialog.FileName);}};conversionLayout.Controls.Add(chooseFile,2,1);
        fileMode.CheckedChanged+=delegate{source.ReadOnly=fileMode.Checked;chooseFile.Visible=fileMode.Checked;source.Clear();};fileMode.Checked=true;
        Label(conversionLayout,"Output Folder",0,2,true);folder.Dock=DockStyle.Fill;conversionLayout.Controls.Add(folder,1,2);conversionLayout.Controls.Add(Button("Browse...",delegate{Browse(folder,true);}),2,2);
        convert.Text="Convert";convert.AutoSize=true;convert.Click+=async delegate{await Work(new Dictionary<string,object>{{"kind","convert"},{"source",source.Text.Trim()},{"folder",folder.Text.Trim()}});};conversionLayout.Controls.Add(convert,1,3);
        var note=new Label{Text="Blank output folder uses the file's folder or selected project for URLs. Existing files are preserved.\nYouTube needs accessible captions. Other video services need a supported transcript first.\nLocal OCR extracts image text; review recognition errors.",AutoSize=true,Dock=DockStyle.Fill};conversionLayout.Controls.Add(note,1,4);conversionLayout.SetColumnSpan(note,2);
        var commandLayout=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=3};commandLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));commandLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));commandLayout.RowStyles.Add(new RowStyle(SizeType.Percent,100));commandLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));command.Controls.Add(commandLayout);
        var selection=Table(3);selector=selection;selection.Padding=new Padding(6,6,6+SystemInformation.VerticalScrollBarWidth,6);selection.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.33f));selection.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.33f));selection.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,33.34f));commands.DropDownStyle=actions.DropDownStyle=environments.DropDownStyle=ComboBoxStyle.DropDownList;commands.Dock=actions.Dock=environments.Dock=DockStyle.Fill;Label(selection,"Command",0,0,true);Label(selection,"Action",1,0,true);Label(selection,"Environment",2,0,true);environments.AccessibleName="Environment";selection.Controls.Add(environments,2,1);commands.AccessibleName="Command";actions.AccessibleName="Action";selection.Controls.Add(commands,0,1);selection.Controls.Add(actions,1,1);commandInfo.AutoSize=true;commandInfo.Dock=DockStyle.Fill;commandLayout.Controls.Add(selection,0,0);
        var scroll=new Panel{AutoScroll=true,Dock=DockStyle.Fill};var formStack=new FlowLayoutPanel{FlowDirection=FlowDirection.TopDown,WrapContents=false,AutoSize=true,Dock=DockStyle.Top};scroll.Controls.Add(formStack);fieldsPanel.FlowDirection=optionsPanel.FlowDirection=FlowDirection.TopDown;fieldsPanel.WrapContents=optionsPanel.WrapContents=false;fieldsPanel.AutoSize=optionsPanel.AutoSize=true;fieldsPanel.Margin=optionsPanel.Margin=Padding.Empty;formStack.Margin=Padding.Empty;formStack.Controls.Add(new Label{Text="Arguments",AutoSize=true,Font=new Font(Font,FontStyle.Bold),Margin=new Padding(10,4,0,4)});formStack.Controls.Add(fieldsPanel);formStack.Controls.Add(optionsPanel);addOption.Text="Add Option";addOption.AutoSize=true;addOption.Click+=delegate{AddOption();};commandLayout.Controls.Add(scroll,0,1);
        var commandButtons=new FlowLayoutPanel{AutoSize=true,Dock=DockStyle.Fill};run.Text="Run Command";help.Text="Command Help";run.AutoSize=help.AutoSize=true;run.Click+=async delegate{await Work(CommandRequest());};help.Click+=async delegate{await Work(new Dictionary<string,object>{{"kind","command"},{"command","help"},{"args","command "+commands.SelectedItem}});};commandButtons.Controls.Add(addOption);commandButtons.Controls.Add(run);commandButtons.Controls.Add(help);commandButtons.Controls.Add(Button("Open Terminal",delegate{try{Process.Start(new ProcessStartInfo(node,AskAI.Quote(Path.Combine(root,"askai.js"))+" cli"){WorkingDirectory=project.Text,UseShellExecute=true});}catch(Exception e){status.Text=e.Message;}}));commandLayout.Controls.Add(commandButtons,0,2);
        commands.SelectedIndexChanged+=delegate{var name=Convert.ToString(commands.SelectedItem);var entry=catalog.FirstOrDefault(c=>TextOf(c,"name")==name);if(entry==null){commands.SelectedItem=lastCommand;return;}lastCommand=name;commandInfo.Text=TextOf(entry,"summary");variants=Objects(entry["variants"]).ToArray();actions.Items.Clear();foreach(var definition in variants)actions.Items.Add(TextOf(definition,"label"));actions.SelectedIndex=0;};actions.SelectedIndexChanged+=delegate{if(actions.SelectedIndex>=0)RefreshForm();};FillCombo(commands,catalog);commands.SelectedItem="status";
        var helpLayout=Table(3);helpContent=helpLayout;helpLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));helpLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));helpLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));helpTab.Controls.Add(helpLayout);Label(helpLayout,"Command",0,0,true);helpCommands.DropDownStyle=ComboBoxStyle.DropDownList;helpCommands.Dock=DockStyle.Fill;helpCommands.AccessibleName="Help Command";FillCombo(helpCommands,catalog);helpCommands.SelectedItem="status";helpLayout.Controls.Add(helpCommands,1,0);EventHandler showHelp=async delegate{await Work(new Dictionary<string,object>{{"kind","command"},{"command","help"},{"args","command "+helpCommands.SelectedItem+" --advanced"}});};helpLayout.Controls.Add(Button("Show Detailed Help",showHelp),2,0);helpCommands.SelectedIndexChanged+=delegate{var name=Convert.ToString(helpCommands.SelectedItem);if(!catalog.Any(c=>TextOf(c,"name")==name)){helpCommands.SelectedItem=lastHelpCommand;return;}lastHelpCommand=name;if(tabs.SelectedTab==helpTab)showHelp(null,EventArgs.Empty);};tabs.SelectedIndexChanged+=delegate{open.Visible=openFolder.Visible=tabs.SelectedTab==conversion;FitTab();if(tabs.SelectedTab==helpTab && Visible)showHelp(null,EventArgs.Empty);};
        output.AccessibleName="Output";output.Multiline=true;output.ReadOnly=true;output.WordWrap=true;output.ScrollBars=ScrollBars.Vertical;output.Font=new Font("Consolas",10);output.Dock=DockStyle.Fill;output.Text="Ready. Choose a file or URL, or select a command.\r\nNo command or source analysis runs on startup.";var outputGroup=new GroupBox{Text="Output",Dock=DockStyle.Fill};outputGroup.Controls.Add(output);layout.Controls.Add(outputGroup,0,3);
        var resultRow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Margin=new Padding(0,10,0,0)};resultRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));resultRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
        var resultButtons=new FlowLayoutPanel{AutoSize=true,AutoSizeMode=AutoSizeMode.GrowAndShrink,WrapContents=false,FlowDirection=FlowDirection.LeftToRight,Anchor=AnchorStyles.Left};resultButtons.Controls.Add(Button("Copy Output",delegate{try{CopyText(output.Text,Clipboard.SetText);status.Text="Output copied.";}catch(Exception e){status.Text="Clipboard unavailable: "+e.Message;}}));stop.Text="Stop";open.Text="Open Markdown";openFolder.Text="Open Folder";stop.AutoSize=open.AutoSize=openFolder.AutoSize=true;stop.Enabled=open.Enabled=openFolder.Enabled=false;stop.Click+=delegate{StopJob();};open.Click+=delegate{if(lastOutput!=null)Process.Start("notepad.exe",AskAI.Quote(lastOutput));};openFolder.Click+=delegate{if(lastOutput!=null)Process.Start("explorer.exe",AskAI.Quote(Path.GetDirectoryName(lastOutput)));};resultButtons.Controls.Add(stop);resultButtons.Controls.Add(open);resultButtons.Controls.Add(openFolder);resultRow.Controls.Add(resultButtons,0,0);
        status.AutoSize=true;status.Text="Ready";status.Dock=DockStyle.Fill;status.TextAlign=ContentAlignment.MiddleRight;status.Margin=new Padding(12,10,4,4);resultRow.Controls.Add(status,1,0);layout.Controls.Add(resultRow,0,4);
        layout.Controls.Add(new Label{Text="Conversion uses local extraction/OCR. Commands that launch AI may use your subscription. Use Open terminal for interactive prompts.",AutoSize=true,Dock=DockStyle.Fill},0,5);
        ApplyTheme();Resize+=delegate{FitTab();};FitTab();
        FormClosing+=delegate(object sender,FormClosingEventArgs e){if(job!=null&&!job.HasExited){if(MessageBox.Show(this,"Stop the running operation and close Ask AI?","Ask AI",MessageBoxButtons.YesNo)!=DialogResult.Yes){e.Cancel=true;return;}closing=true;StopJob();}};
    }
    private void ApplyTheme(){
        var theme=AskAI.Json.Deserialize<Dictionary<string,string>>(File.ReadAllText(Path.Combine(root,"standalone","desktop-theme.json")));
        Func<string,Color> color=key=>ColorTranslator.FromHtml(theme[key]);
        Action<Control> apply=null;apply=control=>{
            control.ForeColor=color("text");control.BackColor=color("surface");
            if(control!=output&&control.Font.FontFamily.Name!=theme["font"])control.Font=new Font(theme["font"],control.Font.Size,control.Font.Style);
            var button=control as Button;if(button!=null){button.FlatStyle=FlatStyle.Flat;button.FlatAppearance.BorderColor=color("border");button.BackColor=color("secondary");button.ForeColor=color("accent");if(button==run||button==convert){button.BackColor=color("accent");button.ForeColor=color("surface");}}
            var combo=control as ComboBox;if(combo!=null)combo.FlatStyle=FlatStyle.Flat;
            var group=control as GroupBox;if(group!=null){group.ForeColor=color("teal");group.Font=new Font(theme["font"],10,FontStyle.Bold);}
            if(control==status)control.ForeColor=color("teal");
            foreach(Control child in control.Controls)apply(child);
        };apply(this);BackColor=color("background");if(output.Font.FontFamily.Name!=theme["monospace"])output.Font=new Font(theme["monospace"],10);output.BackColor=color("surface");
        if(tabs.DrawMode!=TabDrawMode.OwnerDrawFixed){tabs.DrawMode=TabDrawMode.OwnerDrawFixed;tabs.DrawItem+=delegate(object sender,DrawItemEventArgs e){bool active=e.Index==tabs.SelectedIndex;using(var brush=new SolidBrush(color(active?"surface":"secondary")))e.Graphics.FillRectangle(brush,e.Bounds);TextRenderer.DrawText(e.Graphics,tabs.TabPages[e.Index].Text,tabs.Font,e.Bounds,color(active?"accent":"text"),TextFormatFlags.HorizontalCenter|TextFormatFlags.VerticalCenter);};}
    }
    private void StopJob(){try{if(job!=null&&!job.HasExited)Process.Start(new ProcessStartInfo("taskkill.exe","/pid "+job.Id+" /t /f"){UseShellExecute=false,CreateNoWindow=true});}catch(Exception e){status.Text=e.Message;}}
    private async Task Work(Dictionary<string,object> request){
        if(job!=null)return;if(!Directory.Exists(project.Text)){MessageBox.Show(this,"Choose an existing project folder.","Ask AI");return;}string file=Path.Combine(Path.GetTempPath(),"askai-desktop-"+Guid.NewGuid().ToString("N")+".json");
        try{request["project"]=project.Text;File.WriteAllText(file,AskAI.Json.Serialize(request),new UTF8Encoding(false));var info=AskAI.StartInfo(node,AskAI.Quote(Path.Combine(root,"standalone","desktop-bridge.js"))+" "+AskAI.Quote(file));info.WorkingDirectory=project.Text;job=Process.Start(info);run.Enabled=convert.Enabled=help.Enabled=helpCommands.Enabled=false;stop.Enabled=true;open.Enabled=openFolder.Enabled=false;lastOutput=null;status.Text="Running...";output.Text="Working...";
            Task<string> stdout=job.StandardOutput.ReadToEndAsync(),stderr=job.StandardError.ReadToEndAsync();await Task.WhenAll(stdout,stderr);job.WaitForExit();if(closing)return;if(String.IsNullOrWhiteSpace(stdout.Result))throw new Exception("No result. "+stderr.Result);var result=AskAI.Json.Deserialize<Dictionary<string,object>>(stdout.Result);output.Text=Multiline(result.ContainsKey("display")?Convert.ToString(result["display"]):String.Join("\n",new[]{TextOf(result,"stdout"),TextOf(result,"stderr"),stderr.Result}));status.Text="Finished: exit "+result["code"];if(result.ContainsKey("output")&&result["output"]!=null){lastOutput=Convert.ToString(result["output"]);open.Enabled=openFolder.Enabled=true;}
        }catch(Exception e){if(!closing){output.Text=e.Message;status.Text="Failed";}}finally{if(File.Exists(file))File.Delete(file);if(job!=null)job.Dispose();job=null;if(!closing){run.Enabled=convert.Enabled=help.Enabled=helpCommands.Enabled=true;stop.Enabled=false;}}
    }
    internal void SelfTest(){int groups=catalog.Select(c=>TextOf(c,"category")).Distinct().Count();if(helpCommands.Items.Count!=catalog.Length+groups||commands.Items.Count!=catalog.Length+groups)throw new Exception("Help Catalog Missing");foreach(var entry in catalog){commands.SelectedItem=entry["name"];for(int index=0;index<variants.Length;index++){actions.SelectedIndex=index;if(fields.Count!=VisibleFields.Count())throw new Exception("Command fields missing: "+entry["name"]);foreach(var required in VisibleOptions.Where(Required))if(!optionRows.Any(row=>Convert.ToString(row.Flag.SelectedItem)==TextOf(required,"flag")))throw new Exception("Required option missing");}}commands.SelectedItem="why";if(fields.Count!=1)throw new Exception("Required command field missing");commands.SelectedItem="start";if(optionRows.Count!=1||!environments.Enabled)throw new Exception("Required options missing");commands.SelectedItem="mcp";actions.SelectedIndex=variants.Select(v=>TextOf(v,"label")).ToList().IndexOf("confirm");if(fields.Count!=1||optionRows.Count!=2)throw new Exception("MCP confirm fields missing");commands.SelectedItem="update";if(optionRows.Count!=1||Convert.ToString(optionRows[0].Flag.SelectedItem)!="dry-run")throw new Exception("Update auto-row missing");if(Convert.ToString(optionRows[0].Value.Text)!="false")throw new Exception("Auto-shown boolean option must default to false, not silently enable --dry-run");tabs.SelectedIndex=1;FitTab();float commandHeight=tabSize.Height;tabs.SelectedIndex=2;FitTab();if(tabSize.Height>=commandHeight)throw new Exception("Help Tab Wastes Output Space");tabs.SelectedIndex=0;string copied=null;CopyText(Multiline("first\nsecond\n\nthird"),s=>copied=s);if(copied!="first\r\nsecond\r\n\r\nthird")throw new Exception("Multiline copy failed");if(chooseFile.Parent==null||!fileMode.Checked||!source.ReadOnly)throw new Exception("File picker missing");}
}
