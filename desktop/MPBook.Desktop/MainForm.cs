using System.Diagnostics;
using System.Globalization;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Windows.Media.SpeechSynthesis;
using Windows.Storage.Streams;

namespace MPBook.Desktop;

public sealed class MainForm : Form
{
    private const string AppUrl = "https://acewalt.github.io/Mpbook/";
    private const string Channel = "mpbook-native";
    private const string AdapterReleasesUrl = "https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/releases";
    private const string CompatibleVoicesUrl = "https://github.com/gexgd0419/NaturalVoiceSAPIAdapter/wiki/Narrator-natural-voice-download-links";

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

        var voicesItem = new ToolStripMenuItem("Voces");
        var winRtVoicesItem = new ToolStripMenuItem("Voces Windows (WinRT)");
        winRtVoicesItem.Click += (_, _) => ShowInstalledVoices();
        var sapiVoicesItem = new ToolStripMenuItem("Voces SAPI / Natural");
        sapiVoicesItem.Click += (_, _) => ShowSapiVoices();
        voicesItem.DropDownItems.Add(winRtVoicesItem);
        voicesItem.DropDownItems.Add(sapiVoicesItem);

        var naturalItem = new ToolStripMenuItem("Natural Voice");
        var importNaturalItem = new ToolStripMenuItem("Importar voz Natural (.msix)…");
        importNaturalItem.Click += (_, _) => ImportNaturalVoicePackage();
        var adapterItem = new ToolStripMenuItem("Descargar NaturalVoiceSAPIAdapter");
        adapterItem.Click += (_, _) => OpenUrl(AdapterReleasesUrl);
        var compatibleItem = new ToolStripMenuItem("Descargar paquetes Natural compatibles");
        compatibleItem.Click += (_, _) => OpenUrl(CompatibleVoicesUrl);
        naturalItem.DropDownItems.Add(importNaturalItem);
        naturalItem.DropDownItems.Add(new ToolStripSeparator());
        naturalItem.DropDownItems.Add(adapterItem);
        naturalItem.DropDownItems.Add(compatibleItem);

        var reloadItem = new ToolStripMenuItem("Recargar MPBook");
        reloadItem.Click += (_, _) => _webView.CoreWebView2?.Reload();

        menu.Items.Add(voicesItem);
        menu.Items.Add(naturalItem);
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
        OpenUrl(e.Uri);
    }

    private static bool IsAllowedTopLevelUri(string? raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == Uri.UriSchemeHttps
            && uri.Host.Equals("acewalt.github.io", StringComparison.OrdinalIgnoreCase)
            && uri.AbsolutePath.StartsWith("/Mpbook", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsTrustedMessageSource(string? raw) => IsAllowedTopLevelUri(raw);

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
                {
                    string text = GetString(root, "text");
                    string voiceId = GetString(root, "voiceId");
                    if (string.IsNullOrWhiteSpace(text))
                        throw new InvalidOperationException("El texto está vacío.");
                    Reply(id, true, await SynthesizeAsync(text, voiceId));
                    break;
                }

                case "listSapiVoices":
                    Reply(id, true, GetSapiVoiceDtos());
                    break;

                case "synthSapi":
                {
                    string text = GetString(root, "text");
                    string voiceId = GetString(root, "voiceId");
                    if (string.IsNullOrWhiteSpace(text))
                        throw new InvalidOperationException("El texto está vacío.");
                    Reply(id, true, await SynthesizeSapiAsync(text, voiceId));
                    break;
                }

                default:
                    throw new InvalidOperationException("Acción nativa no reconocida: " + action);
            }
        }
        catch (Exception ex)
        {
            if (id != 0) Reply(id, false, null, ex.Message);
        }
    }

    private static string GetString(JsonElement root, string name)
        => root.TryGetProperty(name, out var el) ? el.GetString() ?? "" : "";

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
                source = "winrt",
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

        using var synthesizer = new SpeechSynthesizer { Voice = voice };
        using var stream = await synthesizer.SynthesizeTextToStreamAsync(text);
        ulong size64 = stream.Size;
        if (size64 == 0) throw new InvalidOperationException("Windows devolvió un audio vacío.");
        if (size64 > int.MaxValue || size64 > uint.MaxValue)
            throw new InvalidOperationException("El audio generado es demasiado grande para este puente.");

        using var reader = new DataReader(stream.GetInputStreamAt(0));
        uint loaded = await reader.LoadAsync((uint)size64);
        if (loaded == 0) throw new InvalidOperationException("No se pudieron leer los datos de audio de Windows.");

        var bytes = new byte[(int)loaded];
        reader.ReadBytes(bytes);

        return new
        {
            base64 = Convert.ToBase64String(bytes),
            mime = string.IsNullOrWhiteSpace(stream.ContentType) ? "audio/wav" : stream.ContentType,
            voice = voice.DisplayName,
            language = voice.Language,
            source = "winrt",
        };
    }

    private sealed record SapiVoiceInfo(
        string Id,
        string Name,
        string Language,
        string Gender,
        bool Natural,
        bool Adapter);

    private static SapiVoiceInfo[] GetSapiVoiceInfos()
    {
        Type? voiceType = Type.GetTypeFromProgID("SAPI.SpVoice");
        if (voiceType is null) return [];

        object? voiceObj = null;
        object? tokensObj = null;
        var list = new List<SapiVoiceInfo>();

        try
        {
            voiceObj = Activator.CreateInstance(voiceType);
            if (voiceObj is null) return [];
            dynamic voice = voiceObj;
            tokensObj = voice.GetVoices("", "");
            dynamic tokens = tokensObj;
            int count = Convert.ToInt32(tokens.Count, CultureInfo.InvariantCulture);

            for (int i = 0; i < count; i++)
            {
                object? tokenObj = null;
                try
                {
                    tokenObj = tokens.Item(i);
                    dynamic token = tokenObj;
                    string id = Convert.ToString(token.Id, CultureInfo.InvariantCulture) ?? $"sapi:{i}";
                    string name = SafeSapiDescription(token, id);
                    string language = NormalizeSapiLanguage(SafeSapiAttribute(token, "Language"));
                    string gender = SafeSapiAttribute(token, "Gender").ToLowerInvariant();
                    bool adapter = id.Contains("NaturalVoice", StringComparison.OrdinalIgnoreCase)
                        || id.Contains("NaturalVoiceSAPIAdapter", StringComparison.OrdinalIgnoreCase)
                        || name.Contains("NaturalVoiceSAPIAdapter", StringComparison.OrdinalIgnoreCase);
                    bool natural = adapter
                        || id.Contains("Natural", StringComparison.OrdinalIgnoreCase)
                        || name.Contains("Natural", StringComparison.OrdinalIgnoreCase)
                        || name.Contains("Neural", StringComparison.OrdinalIgnoreCase);

                    list.Add(new SapiVoiceInfo(id, name, language, gender, natural, adapter));
                }
                finally
                {
                    ReleaseCom(tokenObj);
                }
            }
        }
        catch
        {
            return [];
        }
        finally
        {
            ReleaseCom(tokensObj);
            ReleaseCom(voiceObj);
        }

        return list
            .OrderByDescending(v => v.Adapter)
            .ThenByDescending(v => v.Natural)
            .ThenByDescending(v => v.Language.StartsWith("es", StringComparison.OrdinalIgnoreCase))
            .ThenBy(v => v.Name, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
    }

    private static object[] GetSapiVoiceDtos()
    {
        return GetSapiVoiceInfos()
            .Select(v => new
            {
                id = v.Id,
                name = v.Name,
                language = v.Language,
                gender = v.Gender,
                natural = v.Natural,
                adapter = v.Adapter,
                source = "sapi",
            })
            .Cast<object>()
            .ToArray();
    }

    private static string SafeSapiDescription(dynamic token, string fallback)
    {
        try
        {
            string? value = Convert.ToString(token.GetDescription(0), CultureInfo.CurrentCulture);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        catch { }
        try
        {
            string? value = Convert.ToString(token.GetDescription(), CultureInfo.CurrentCulture);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        catch { }
        return fallback;
    }

    private static string SafeSapiAttribute(dynamic token, string attribute)
    {
        try { return Convert.ToString(token.GetAttribute(attribute), CultureInfo.InvariantCulture) ?? ""; }
        catch { return ""; }
    }

    private static string NormalizeSapiLanguage(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        string first = raw.Split(';', ',', ' ')[0].Trim();
        try
        {
            int lcid = int.Parse(first, NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            return CultureInfo.GetCultureInfo(lcid).Name;
        }
        catch
        {
            return raw;
        }
    }

    private static Task<object> SynthesizeSapiAsync(string text, string voiceId)
    {
        var tcs = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try { tcs.SetResult(SynthesizeSapiCore(text, voiceId)); }
            catch (Exception ex) { tcs.SetException(ex); }
        })
        {
            IsBackground = true,
            Name = "MPBook SAPI TTS",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return tcs.Task;
    }

    private static object SynthesizeSapiCore(string text, string voiceId)
    {
        Type? voiceType = Type.GetTypeFromProgID("SAPI.SpVoice");
        Type? streamType = Type.GetTypeFromProgID("SAPI.SpFileStream");
        if (voiceType is null || streamType is null)
            throw new InvalidOperationException("SAPI 5 no está disponible en este Windows.");

        string tempPath = Path.Combine(Path.GetTempPath(), $"mpbook-{Guid.NewGuid():N}.wav");
        object? voiceObj = null;
        object? tokensObj = null;
        object? selectedTokenObj = null;
        object? streamObj = null;

        try
        {
            voiceObj = Activator.CreateInstance(voiceType)
                ?? throw new InvalidOperationException("No se pudo iniciar SAPI.SpVoice.");
            dynamic voice = voiceObj;
            tokensObj = voice.GetVoices("", "");
            dynamic tokens = tokensObj;
            int count = Convert.ToInt32(tokens.Count, CultureInfo.InvariantCulture);

            for (int i = 0; i < count; i++)
            {
                object? candidateObj = tokens.Item(i);
                dynamic candidate = candidateObj;
                string id = Convert.ToString(candidate.Id, CultureInfo.InvariantCulture) ?? "";
                if (id == voiceId)
                {
                    selectedTokenObj = candidateObj;
                    break;
                }
                ReleaseCom(candidateObj);
            }

            if (selectedTokenObj is null)
                throw new InvalidOperationException("La voz SAPI seleccionada ya no está disponible. Recarga MPBook.");

            dynamic selectedToken = selectedTokenObj;
            string voiceName = SafeSapiDescription(selectedToken, voiceId);
            string language = NormalizeSapiLanguage(SafeSapiAttribute(selectedToken, "Language"));
            voice.Voice = selectedToken;

            streamObj = Activator.CreateInstance(streamType)
                ?? throw new InvalidOperationException("No se pudo iniciar SAPI.SpFileStream.");
            dynamic fileStream = streamObj;
            fileStream.Open(tempPath, 3, false); // SSFMCreateForWrite
            voice.AudioOutputStream = fileStream;
            voice.Speak(text, 0); // SPF_DEFAULT, síncrono
            fileStream.Close();

            byte[] bytes = File.ReadAllBytes(tempPath);
            if (bytes.Length <= 44)
                throw new InvalidOperationException("SAPI devolvió un audio vacío.");

            return new
            {
                base64 = Convert.ToBase64String(bytes),
                mime = "audio/wav",
                voice = voiceName,
                language,
                source = "sapi",
            };
        }
        finally
        {
            try
            {
                if (streamObj is not null)
                {
                    dynamic stream = streamObj;
                    try { stream.Close(); } catch { }
                }
            }
            catch { }

            ReleaseCom(streamObj);
            ReleaseCom(selectedTokenObj);
            ReleaseCom(tokensObj);
            ReleaseCom(voiceObj);
            try { if (File.Exists(tempPath)) File.Delete(tempPath); } catch { }
        }
    }

    private static void ReleaseCom(object? obj)
    {
        if (obj is null || !Marshal.IsComObject(obj)) return;
        try { Marshal.FinalReleaseComObject(obj); } catch { }
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
            var winRt = SpeechSynthesizer.AllVoices.ToArray();
            int winSpanish = winRt.Count(v => v.Language.StartsWith("es", StringComparison.OrdinalIgnoreCase));
            var sapi = GetSapiVoiceInfos();
            int sapiSpanish = sapi.Count(v => v.Language.StartsWith("es", StringComparison.OrdinalIgnoreCase));
            int sapiNatural = sapi.Count(v => v.Natural);
            _voiceStatus.Text = $"WinRT: {winRt.Length} ({winSpanish} ES) · SAPI: {sapi.Length} ({sapiSpanish} ES, {sapiNatural} Natural)";
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

            ShowTextDialog("Voces detectadas por Windows (WinRT)", text);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Error al listar voces", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ShowSapiVoices()
    {
        try
        {
            var voices = GetSapiVoiceInfos();
            string text = voices.Length == 0
                ? "SAPI 5 no devolvió ninguna voz. Si quieres Jorge/Dalia Natural, instala NaturalVoiceSAPIAdapter y luego importa un paquete compatible."
                : string.Join(Environment.NewLine, voices.Select(v =>
                    $"{(v.Natural ? "★ " : "  ")}{v.Name} | {v.Language} | {v.Gender}\r\n    ID: {v.Id}"));
            ShowTextDialog("Voces SAPI / Natural detectadas", text);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Error al listar voces SAPI", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void ShowTextDialog(string title, string text)
    {
        using var dialog = new Form
        {
            Text = title,
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

    private void ImportNaturalVoicePackage()
    {
        using var picker = new OpenFileDialog
        {
            Title = "Selecciona un paquete de voz Natural compatible",
            Filter = "Paquete de voz (*.msix;*.appx;*.zip)|*.msix;*.appx;*.zip|Todos los archivos (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false,
        };

        if (picker.ShowDialog(this) != DialogResult.OK) return;

        try
        {
            string root = GetNaturalVoiceRoot();
            Directory.CreateDirectory(root);

            string baseName = MakeAsciiFolderName(Path.GetFileNameWithoutExtension(picker.FileName));
            string destination = Path.Combine(root, baseName);
            if (Directory.Exists(destination)) Directory.Delete(destination, true);
            Directory.CreateDirectory(destination);

            ZipFile.ExtractToDirectory(picker.FileName, destination, overwriteFiles: true);

            using (var key = Registry.CurrentUser.CreateSubKey(@"Software\NaturalVoiceSAPIAdapter\Enumerator", writable: true))
            {
                key?.SetValue("NarratorVoicePath", root, RegistryValueKind.String);
                key?.SetValue("NoNarratorVoices", 0, RegistryValueKind.DWord);
            }

            try { Clipboard.SetText(root); } catch { }
            UpdateVoiceStatus();

            if (!IsNaturalAdapterInstalled())
            {
                var answer = MessageBox.Show(
                    this,
                    "La voz se desempaquetó en:\n\n" + root +
                    "\n\nMPBook ya configuró ese directorio como NarratorVoicePath.\n\n" +
                    "Todavía falta instalar NaturalVoiceSAPIAdapter (64-bit) para que SAPI pueda usarla. " +
                    "¿Quieres abrir ahora la página de descargas del adaptador?",
                    "Voz Natural importada",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information);

                if (answer == DialogResult.Yes) OpenUrl(AdapterReleasesUrl);
            }
            else
            {
                MessageBox.Show(
                    this,
                    "La voz se desempaquetó y se configuró correctamente en:\n\n" + root +
                    "\n\nCierra y vuelve a abrir MPBook Desktop para que el adaptador vuelva a enumerar las voces. " +
                    "Después revisa Voces → Voces SAPI / Natural.",
                    "Voz Natural importada",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
        }
        catch (InvalidDataException)
        {
            MessageBox.Show(
                this,
                "Ese archivo no parece ser un paquete MSIX/APPX válido. Descarga una versión compatible desde la wiki de NaturalVoiceSAPIAdapter.",
                "Paquete no válido",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "No se pudo importar la voz", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string GetNaturalVoiceRoot()
    {
        string? publicDir = Environment.GetEnvironmentVariable("PUBLIC");
        if (!string.IsNullOrWhiteSpace(publicDir) && IsAscii(publicDir))
            return Path.Combine(publicDir, "MPBookVoices");

        string commonDocs = Environment.GetFolderPath(Environment.SpecialFolder.CommonDocuments);
        if (!string.IsNullOrWhiteSpace(commonDocs) && IsAscii(commonDocs))
            return Path.Combine(commonDocs, "MPBookVoices");

        throw new InvalidOperationException(
            "No encontré una ruta pública con caracteres ASCII. NaturalVoiceSAPIAdapter requiere una ruta sin caracteres especiales.");
    }

    private static string MakeAsciiFolderName(string value)
    {
        var chars = value.Select(ch =>
            ch <= 127 && (char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.') ? ch : '_').ToArray();
        string result = new string(chars).Trim('_', '.');
        return string.IsNullOrWhiteSpace(result) ? "voice" : result;
    }

    private static bool IsAscii(string value) => value.All(ch => ch < 128);

    private static bool IsNaturalAdapterInstalled()
    {
        foreach (RegistryView view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            try
            {
                using var lm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
                using var key = lm.OpenSubKey(@"SOFTWARE\Microsoft\Speech\Voices\TokenEnums", writable: false);
                if (key?.GetSubKeyNames().Any(name =>
                    name.Contains("NaturalVoice", StringComparison.OrdinalIgnoreCase)) == true)
                    return true;
            }
            catch { }
        }
        return false;
    }

    private static void OpenUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch { }
    }
}
