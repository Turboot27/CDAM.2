# CDAM Noticias

## Ejecutar en Windows

1. Instala Node.js 20 o una versión más reciente desde [nodejs.org](https://nodejs.org/). Durante la instalación, deja activada la opción para agregar Node al PATH.
2. Abre una ventana interactiva de PowerShell en esta carpeta (no ejecutes la configuración redirigiendo texto o desde una tarea sin terminal).
3. Ejecuta `npm run setup` una sola vez. El asistente pedirá:
   - La contraseña que usarán los lectores. Puedes conservar tu clave actual o elegir otra; es más seguro cambiarla porque la anterior estaba escrita en el HTML.
   - Un nombre de usuario para la cuenta administradora.
   - Una contraseña administradora nueva de al menos 12 caracteres. Elige una distinta de la clave de publicación anterior, porque esa estaba en el HTML.
4. Ejecuta `npm start` y abre <http://127.0.0.1:8765>.
5. Para detener el servidor, vuelve a PowerShell y presiona Ctrl+C.

La contraseña de lectura y la clave administradora se guardan como hashes en `config.json`; ese archivo está excluido del control de versiones. El servidor guarda noticias y comentarios en `data/news.json`. Ambos archivos se crean localmente y no se deben borrar si quieres conservar la configuración y las publicaciones.

El sitio no requiere dependencias externas. Mantén `server.js`, `miprimerproyecto.html`, `app.js` y `styles.css` juntos. El JavaScript y los estilos se sirven como archivos independientes para permitir una política de seguridad de contenido estricta y cargar los recursos desde la caché del navegador.

Al iniciar sesión como administrador en el mismo navegador que usabas antes, la aplicación intenta importar las noticias y comentarios que estaban guardados allí. La importación requiere la sesión administradora y no permite publicar por sí sola.

Las sesiones duran hasta 8 horas y terminan al cerrar sesión o reiniciar el servidor. Este proyecto escucha solo en `127.0.0.1`, así que funciona en tu propia computadora y **todavía no está publicado en internet**. Para alojarlo detrás de un proxy HTTPS en una VM, inicia Node con `HOST=127.0.0.1` y el puerto que proporcione el proxy (por ejemplo, `PORT=8765`); no expongas el servidor directamente a internet ni actives `NODE_ENV=production` sin HTTPS.

El almacenamiento JSON es adecuado para una instalación local pequeña con un solo servidor. Para uso público con varios procesos o mucho tráfico se debe migrar a una base de datos y un almacén persistente de sesiones.

## Publicar en Render

1. Sube este proyecto a un repositorio de GitHub. No incluyas `config.json` ni archivos de `data/`; contienen configuración y publicaciones locales.
2. En Render, crea un **New Web Service** y conecta ese repositorio.
3. Usa estos valores:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Runtime:** Node
4. En **Environment**, agrega:
   - `HOST` = `0.0.0.0`
   - `READER_PASSWORD` = la clave que usarán los lectores
   - `ADMIN_USERNAME` = el usuario administrador (3–40 letras, números, punto, guion o guion bajo)
   - `ADMIN_PASSWORD` = una clave nueva de al menos 12 caracteres
   Render proporciona `PORT` automáticamente. No configures `NODE_ENV` manualmente; Render sirve la aplicación detrás de HTTPS.
5. Pulsa **Deploy**. Cuando termine, abre la dirección `onrender.com` que muestra Render.

En Render, el sistema de archivos del servicio puede ser temporal: las noticias y comentarios pueden perderse al reiniciar o desplegar. Para conservarlos, agrega un disco persistente si tu plan lo permite, móntalo en `/var/data` y configura `DATA_DIR` = `/var/data`. Sin un disco persistente, usa el sitio como demostración y no como archivo permanente de noticias.

El archivo `styles.css` sigue enlazado desde la página. Si te refieres a un diseño anterior distinto, comparte una captura o descríbeme qué elementos quieres recuperar para poder restaurarlo sin adivinar.
