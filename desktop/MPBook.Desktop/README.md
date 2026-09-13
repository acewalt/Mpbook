# MPBook Desktop (Windows)

Versión de escritorio de MPBook que reutiliza la web existente dentro de WebView2 y añade un puente nativo a `Windows.Media.SpeechSynthesis`.

## Qué añade

- Motor adicional `Windows · voces instaladas` dentro de Ajustes de voz.
- Enumera las voces que Windows expone mediante `SpeechSynthesizer.AllVoices`.
- Muestra idioma, género y marca las voces cuyo nombre/ID/descripcion contiene `Natural`.
- Sintetiza el texto con la voz elegida y devuelve el audio a MPBook.
- Mantiene disponibles Piper, Kokoro, Navegador y los motores cloud de la web.
- Menú `Voces de Windows` para comprobar rápidamente exactamente qué voces ve la API nativa.

> Importante: que Narrador muestre Jorge/Dalia/Álvaro/Elvira no garantiza que `SpeechSynthesizer.AllVoices` las exponga. Esta aplicación sirve precisamente para comprobarlo en el PC real. Si aparecen en el menú `Voces de Windows`, también deben aparecer en el nuevo motor de MPBook.

## Compilar en Windows

Requisitos de compilación:

- Windows 10/11 x64.
- .NET 8 SDK.
- Microsoft Edge WebView2 Runtime (Windows 11 normalmente ya lo incluye).

Ejecuta:

```bat
build.bat
```

El ejecutable se genera en:

```text
publish\MPBook.Desktop.exe
```

El `publish` es self-contained, por lo que el PC donde se ejecute no necesita tener instalado el runtime de .NET 8.

## Probar las voces naturales de Windows

1. Abre `MPBook.Desktop.exe`.
2. En la barra superior pulsa `Voces de Windows`.
3. Busca `Jorge`, `Dalia`, `Álvaro` o `Elvira`.
4. Si aparecen, entra en MPBook > Ajustes de voz > `Windows · voces instaladas`.
5. Selecciona la voz y reproduce un fragmento.

La exportación de libro completo usando el motor Windows queda temporalmente bloqueada hasta validar en hardware real el formato exacto del `SpeechSynthesisStream`. Reproducción y caché de fragmentos sí usan el puente nativo.
