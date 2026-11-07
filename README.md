# PC Factory

Sitio estático de PC Factory publicado en GitHub Pages. El catálogo se administra manualmente en Google Sheets y la tienda lo consulta mediante Google Apps Script.

## Fichas de producto e indexación

El workflow **Sync product pages from Google Sheets** genera páginas HTML individuales en `productos/`, actualiza los enlaces HTML de la portada y mantiene el sitemap usando la misma hoja del catálogo. Se ejecuta diariamente y también puede iniciarse manualmente desde la pestaña **Actions** de GitHub para publicar los cambios de la hoja de inmediato.

Las páginas y la portada se publican desde la rama `main` como el resto del sitio. El workflow necesita permiso de escritura al contenido del repositorio para guardar el catálogo generado. No edites a mano los archivos de `productos/`; se regeneran desde Google Sheets.

Para publicar las fichas inmediatamente después de modificar la hoja, abre **Actions → Sync product pages from Google Sheets → Run workflow**. El workflow también se ejecuta una vez al día. En **Settings → Actions → General**, los permisos del `GITHUB_TOKEN` deben permitir escritura si el repositorio tiene restringidos los permisos de workflows.