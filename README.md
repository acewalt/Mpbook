# MPBook

MPBook es una PWA estática para leer **EPUB, Markdown y TXT** y convertir el contenido en voz desde el navegador.

## Funciones

- Interfaz en **español por defecto**.
- Botón **ES / EN** para cambiar toda la interfaz entre español e inglés.
- Arrastrar y soltar archivos `.epub`, `.md`, `.markdown` y `.txt`.
- Parser EPUB local: el libro se procesa en el dispositivo, sin subirlo a un servidor de MPBook.
- Separación por capítulos y fragmentos.
- Lectura con **Web Speech API** del navegador, sin API key.
- Lectura con **OpenAI TTS** mediante una API key guardada únicamente en `localStorage` del navegador.
- Biblioteca local mediante IndexedDB y recuperación del progreso.
- Exportación MP3 cuando se usa el motor OpenAI.
- PWA instalable y service worker para uso offline de la interfaz.
- Tema oscuro/claro y diseño responsive para móvil y escritorio.

## GitHub Pages

El proyecto está preparado para publicarse directamente desde:

- Branch: `main`
- Folder: `/ (root)`

No requiere compilación ni backend.

## Privacidad

Los EPUB y textos se analizan en el navegador. Cuando se usa la voz integrada del navegador, MPBook no envía el contenido a un servidor propio. Cuando se selecciona OpenAI, los fragmentos que se sintetizan se envían directamente desde el navegador al endpoint de OpenAI usando la clave introducida por el usuario.

## Nota sobre el proyecto de referencia

MPBook fue diseñado tomando como referencia funcional la idea de `scandnavik/audiobook`, pero esta implementación fue escrita de forma independiente. El repositorio de referencia no publica actualmente un archivo de licencia en su rama principal, por lo que su código no se copió literalmente.
