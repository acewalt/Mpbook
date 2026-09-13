using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Windows.Media.SpeechSynthesis;
using Windows.Storage.Streams;

namespace MPBook.Desktop;

public sealed class MainForm : Form
{
    private const string AppUrl = "https://acewalt.github.io/Mpbook/";
    private const string Channel = "mpbook-native";

    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly ToolStripStatusLabel _voiceStatus = new("Windows TTS: comprobando voces…");

    public MainForm()
    {
        Text = "MPBook Desktop";
        Width = 1280;
        Height = 820;
        MinimumSize = new Size(900, 620);
        StartPosition = FormStartPosition.CenterScreen;

        var menu = new MenuStrip();
        var voicesItem = new ToolStripMenuItem("Voces de Windows");
        voicesItem.Click += (_, _) => ShowInstalledVoices();
        var reloadItem = new ToolStripMenuItem("Recargar MPBook");
        reloadItem.Click += (_, _) => _webView.CoreWebView2?.Reload();
        menu.Items.Add(voicesItem);
        menu.Items.Add(reloadItem);

        var status = new StatusStrip();
        status.Items.Add(_voiceStatus);

        Controls.Add(_webView);
        Controls.Add(status);
        Controls.Add(menu);
        MainMenuStrip = menu;

        Shown += async (_, _) => await InitializeWebViewAsync();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MPBook",
                "WebView2");

            Directory.CreateDirectory(userData);
            var env = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await _webView.EnsureCoreWebView2Async(env);

            _webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            _webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            _webView.CoreWebView2.Settings.IsStatusBarEnabled = false;

            _webView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
            _webView.CoreWebView2.NavigationStarting += CoreWebView2_NavigationStarting;
            _webView.CoreWebView2.NavigationCompleted += (_, e) =>
            {
                if (!e.IsSuccess)
                    _voiceStatus.Text = $"No se pudo abrir MPBook: {e.WebErrorStatus}";
            };

            UpdateVoiceStatus();
            _webView.Source = new Uri(AppUrl);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                this,
                "No se pudo iniciar MPBook Desktop.\n\n" + ex.Message,
                "MPBook Desktop",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private void CoreWebView2_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (IsAllowedTopLevelUri(e.Uri)) return;

        e.Cancel = true;
        try
        {
            Process.Start(new ProcessStartInfo(e.Uri) { UseShellExecute = true });
        }
        catch
        {
            // Si Windows no puede abrir el enlace externamente, simplemente queda bloqueado dentro de MPBook.
        }
    }

    private static bool IsAllowedTopLevelUri(string? raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == Uri.UriSchemeHttps
            && uri.Host.Equals("acewalt.github.io", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.StartsWith("/Mpbook", StringComparison.OrdinalIgnoreCase);
    }

    private bool IsTrustedMessageSource(string? raw)
    {
        return IsAllowedTopLevelUri(raw);
    }

    private async void CoreWebView2_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!IsTrustedMessageSource(e.Source)) return;

        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;

            if (!root.TryGetProperty("channel", out var channelEl)
                || channelEl.GetString() != Channel)
                return;

            if (!root.TryGetProperty("id", out var idEl) || !idEl.TryGetInt32(out id))
                return;

            string action = root.TryGetProperty("action", out var actionEl)
                ? actionEl.GetString() ?? ""
                : "";

            switch (action)
            {
                case "listVoices":
                    Reply(id, true, GetVoiceDtos());
                    break;

                case "synth":
                    string text = root.TryGetProperty("text", out var textEl)
                        ? textEl.GetString() ?? ""
                        : "";
                    string voiceId = root.TryGetProperty("voiceId", out var voiceEl)
                        ? voiceEl.GetString() ?? ""
                        : "";

                    if (string.IsNullOrWhiteSpace(text))
                        throw new InvalidOperationException("El texto está vacío.");

                    var audio = await SynthesizeAsync(text, voiceId);
                    Reply(id, true, audio);
                    break;

                default:
                    throw new InvalidOperationException("Acción nativa no reconocida: " + action);
            }
        }
        catch (Exception ex)
        {
            if (id != 0) Reply(id, false, null, ex.Message);
        }
    }

    private static object[] GetVoiceDtos()
    {
        return SpeechSynthesizer.AllVoices
            .OrderByDescending(v => IsNaturalVoice(v))
            .ThenByDescending(v => v.Language.StartsWith("es", StringComparison.OrdinalIgnoreCase))
            .ThenBy(v => v.DisplayName, StringComparer.CurrentCultureIgnoreCase)
            .Select(v => new
            {
                id = v.Id,
                name = v.DisplayName,
                language = v.Language,
                gender = v.Gender.ToString().ToLowerInvariant(),
                description = v.Description,
                natural = IsNaturalVoice(v),
            })
            .Cast<object>()
            .ToArray();
    }

    private static bool IsNaturalVoice(VoiceInformation voice)
    {
        return voice.DisplayName.Contains("Natural", StringComparison.OrdinalIgnoreCase)
            || voice.Description.Contains("Natural", StringComparison.OrdinalIgnoreCase)
            || voice.Id.Contains("Natural", StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<object> SynthesizeAsync(string text, string voiceId)
    {
        var voice = SpeechSynthesizer.AllVoices.FirstOrDefault(v => v.Id == voiceId)
            ?? SpeechSynthesizer.DefaultVoice
            ?? throw new InvalidOperationException("Windows no encontró una voz TTS disponible.");

        using var synthesizer = new SpeechSynthesizer
        {
            Voice = voice,
        };

        using var stream = await synthesizer.SynthesizeTextToStreamAsync(text);
        ulong size64 = stream.Size;
        if (size64 == 0) throw new InvalidOperationException("Windows devolvió un audio vacío.");
        if (size64 > int.MaxValue || size64 > uint.MaxValue)
            throw new InvalidOperationException("El audio generado es demasiado grande para este puente.");

        using var reader = new DataReader(stream.GetInputStreamAt(0));
        uint size = (uint)size64;
        uint loaded = await reader.LoadAsync(size);
        if (loaded == 0) throw new InvalidOperationException("No se pudieron leer los datos de audio de Windows.");

        var bytes = new byte[(int)loaded];
        reader.ReadBytes(bytes);

        return new
        {
            base64 = Convert.ToBase64String(bytes),
            mime = string.IsNullOrWhiteSpace(stream.ContentType) ? "audio/wav" : stream.ContentType,
            voice = voice.DisplayName,
            language = voice.Language,
        };
    }

    private void Reply(int id, bool ok, object? result = null, string? error = null)
    {
        string json = JsonSerializer.Serialize(new
        {
            channel = Channel,
            id,
            ok,
            result,
            error,
        });

        PostJson(json);
    }

    private void PostJson(string json)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)(() => PostJson(json)));
            return;
        }
        _webView.CoreWebView2?.PostWebMessageAsJson(json);
    }

    private void UpdateVoiceStatus()
    {
        try
        {
            var voices = SpeechSynthesizer.AllVoices.ToArray();
            int natural = voices.Count(IsNaturalVoice);
            int spanish = voices.Count(v => v.Language.StartsWith("es", StringComparison.OrdinalIgnoreCase));
            _voiceStatus.Text = $"Windows TTS: {voices.Length} voces · {spanish} en español · {natural} Natural detectadas";
        }
        catch (Exception ex)
        {
            _voiceStatus.Text = "Windows TTS: error al enumerar voces — " + ex.Message;
        }
    }

    private void ShowInstalledVoices()
    {
        try
        {
            var voices = SpeechSynthesizer.AllVoices
                .OrderByDescending(IsNaturalVoice)
                .ThenBy(v => v.Language)
                .ThenBy(v => v.DisplayName)
                .ToArray();

            string text = voices.Length == 0
                ? "Windows.Media.SpeechSynthesis no devolvió ninguna voz."
                : string.Join(Environment.NewLine, voices.Select(v =>
                    $"{(IsNaturalVoice(v) ? "★ " : "  ")}{v.DisplayName} | {v.Language} | {v.Gender}\r\n    ID: {v.Id}"));

            using var dialog = new Form
            {
                Text = "Voces detectadas por Windows",
                Width = 900,
                Height = 650,
                StartPosition = FormStartPosition.CenterParent,
            };

            var box = new TextBox
            {
                Dock = DockStyle.Fill,
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Both,
                WordWrap = false,
                Font = new Font("Consolas", 10),
                Text = text,
            };

            dialog.Controls.Add(box);
            dialog.ShowDialog(this);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Error al listar voces", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
