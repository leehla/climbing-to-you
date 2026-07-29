# Climbing to You

Una página privada para parejas a distancia. Una persona esconde una nota de voz
en la cima y la otra debe completar una pequeña ruta de escalada para
desbloquearla.

La interfaz de la página está completamente en inglés. Esta guía está en español
para facilitar la instalación.

## Lo que ya funciona

- Minijuego táctil de siete presas.
- El audio permanece bloqueado hasta alcanzar la cima.
- Grabación desde celular o computadora, con vista previa.
- Modo demo sin cuentas: permite grabar, escalar y escuchar durante la sesión.
- Dos cuentas privadas mediante Supabase.
- Audios guardados en un bucket privado.
- Políticas RLS que permiten acceso únicamente al emisor y su pareja.
- Publicación automática mediante GitHub Pages.
- Diseño adaptable a celulares, tabletas y computadoras.

## 1. Probar el modo demo

No necesitas configurar nada para ver el diseño y probar la mecánica:

1. Abre una terminal dentro de este proyecto.
2. Ejecuta:

   ```bash
   python3 -m http.server 8000 --directory site
   ```

3. Visita `http://localhost:8000`.
4. Entra en **Leave a voice**, graba un mensaje y pulsa **Hide at the summit**.
5. Vuelve al inicio, pulsa **Start climbing** y completa las siete presas.

La grabación del modo demo solo vive en la memoria del navegador y desaparece
al recargar. Eso es intencional.

## 2. Crear el espacio privado en Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. Abre **SQL Editor**.
3. Copia y ejecuta todo el archivo `supabase/supabase-setup.sql`.
4. Abre **Project Settings → API**.
5. Copia:

   - Project URL
   - Publishable key o `anon` key

6. Abre `site/config.js` y reemplaza:

   ```js
   supabaseUrl: "YOUR_SUPABASE_URL",
   supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
   ```

La clave pública/publishable puede estar en el navegador porque el acceso real
está protegido por RLS. **Nunca coloques la clave `service_role` en
`config.js`, GitHub ni el navegador.**

## 3. Publicar en GitHub Pages

1. Crea un repositorio nuevo en GitHub.
2. Sube el contenido completo de esta carpeta, conservando:

   - `site/`
   - `supabase/`
   - `.github/workflows/deploy-pages.yml`
   - `README.md`

3. Asegúrate de que la rama se llame `main`.
4. En GitHub abre **Settings → Pages**.
5. En **Source**, selecciona **GitHub Actions**.
6. El workflow publicará la carpeta `site` y mostrará la URL al terminar.

La dirección normalmente tendrá esta forma:

```text
https://TU-USUARIO.github.io/NOMBRE-DEL-REPOSITORIO/
```

## 4. Configurar las direcciones de autenticación

En Supabase abre **Authentication → URL Configuration**:

- Coloca la URL de GitHub Pages como **Site URL**.
- Añade la misma dirección en **Redirect URLs**.
- Para pruebas locales, añade también `http://localhost:8000/**`.

En **Authentication → Providers → Email** puedes decidir si las cuentas
necesitan confirmar su correo.

## 5. Crear y unir las dos cuentas

1. Cada persona abre la página, pulsa **Sign in** y luego
   **Create this account instead**.
2. Después de que ambas cuentas existan, abre Supabase **SQL Editor**.
3. Ejecuta esta línea usando sus correos reales:

   ```sql
   select public.pair_climbers(
     'primera-persona@example.com',
     'segunda-persona@example.com'
   );
   ```

4. Recarguen la página e inicien sesión.

Desde ese momento:

- Cada persona puede dejar un audio para la otra.
- Solamente la persona destinataria puede escucharlo.
- El archivo utiliza un enlace temporal y el bucket continúa siendo privado.

## Personalización rápida

En `site/index.html` puedes cambiar frases como:

- `A little love, one hold at a time`
- `Climb all the way to hear me.`
- `Summit Secret`

Los colores están al inicio de `site/styles.css`. Los principales son:

```css
--cream: #fff7ea;
--sage: #7c9a78;
--pine: #294a3b;
--peach: #f2a27e;
--butter: #f6d96b;
--purple: #7b61a8;
```

## Privacidad

- El repositorio puede ser público porque no contiene audios ni contraseñas.
- El bucket `voice-notes` debe permanecer privado.
- No desactives las políticas RLS del archivo SQL.
- No guardes una clave `service_role` en archivos publicados.
- Si cambias la estructura de las carpetas de audio, actualiza también las
  políticas de Storage.

