// Generates standalone/askai.ico: a teal circular "AI" badge on a navy square, matching the badge
// AskWindow's own header already draws (standalone/desktop.cs, the header.Paint handler) and the
// navy/teal colors in standalone/desktop-theme.json. Multi-resolution (16/32/48/256) so it looks
// right in the taskbar, Alt-Tab, the title bar and Explorer's large-icon view alike.
// Regenerate after a theme or badge design change:
//   "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /out:build-app-icon.exe
//     /reference:System.Drawing.dll scripts\build-app-icon.cs
//   build-app-icon.exe standalone\askai.ico
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

internal static class BuildAppIcon {
    private const string Navy = "#13203A";
    private const string Accent = "#2DD4BF";
    private static readonly int[] Sizes = { 16, 32, 48, 256 };

    private static Bitmap Render(int size) {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp)) {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using (var navy = new SolidBrush(ColorTranslator.FromHtml(Navy))) {
                var corner = size / 4f;
                using (var path = RoundedRect(new RectangleF(0, 0, size, size), corner)) g.FillPath(navy, path);
            }
            float pad = size * 0.14f;
            var circle = new RectangleF(pad, pad, size - pad * 2, size - pad * 2);
            using (var accent = new SolidBrush(ColorTranslator.FromHtml(Accent))) g.FillEllipse(accent, circle);
            using (var white = new SolidBrush(Color.White))
            using (var font = new Font("Segoe UI", size * 0.34f, FontStyle.Bold, GraphicsUnit.Pixel))
                g.DrawString("AI", font, white, circle, new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center });
        }
        return bmp;
    }

    private static GraphicsPath RoundedRect(RectangleF r, float radius) {
        var path = new GraphicsPath();
        float d = radius * 2;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    // .ico container with one PNG-compressed image per size (ICONDIR + ICONDIRENTRY[] + PNG bytes),
    // the format Windows Vista and later read directly -- no indexed-BMP frames needed.
    private static void WriteIco(string path, Bitmap[] images) {
        using (var fs = new FileStream(path, FileMode.Create))
        using (var w = new BinaryWriter(fs)) {
            w.Write((short)0); w.Write((short)1); w.Write((short)images.Length);
            var pngBytes = new byte[images.Length][];
            int offset = 6 + images.Length * 16;
            for (int i = 0; i < images.Length; i++) {
                using (var ms = new MemoryStream()) { images[i].Save(ms, ImageFormat.Png); pngBytes[i] = ms.ToArray(); }
                int size = images[i].Width; // 256 is encoded as 0 per the ICO spec
                w.Write((byte)(size == 256 ? 0 : size)); w.Write((byte)(size == 256 ? 0 : size));
                w.Write((byte)0); w.Write((byte)0); w.Write((short)1); w.Write((short)32);
                w.Write(pngBytes[i].Length); w.Write(offset);
                offset += pngBytes[i].Length;
            }
            foreach (var data in pngBytes) w.Write(data);
        }
    }

    private static int Main(string[] args) {
        if (args.Length != 1) { Console.Error.WriteLine("Usage: build-app-icon.exe <output.ico>"); return 1; }
        var images = Array.ConvertAll(Sizes, Render);
        WriteIco(args[0], images);
        Console.WriteLine("wrote " + args[0] + " (" + string.Join(", ", Sizes) + " px)");
        return 0;
    }
}
