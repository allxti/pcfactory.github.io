#!/usr/bin/env python3
"""Generate crawlable product pages from the public Google Sheets catalog."""

from __future__ import annotations

import html
import json
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SITE_URL = "https://pcfactory.site/"
PRODUCTS_PATH = "productos/"
MANIFEST_NAME = ".generated-pages.json"
SITEMAP_PATH = ROOT / "sitemap.xml"
INDEX_PATH = ROOT / "index.html"
APP_PATH = ROOT / "js" / "app.js"
START_MARKER = "<!-- PRODUCT PAGES:START -->"
END_MARKER = "<!-- PRODUCT PAGES:END -->"
SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"


def escape(value: object) -> str:
    return html.escape(str(value), quote=True)


def slugify(value: object) -> str:
    normalized = unicodedata.normalize("NFD", str(value).lower().replace("ß", "ss"))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text).strip("-")
    return slug or "producto"


def parse_price(value: object) -> float:
    text = re.sub(r"[^0-9,.-]", "", str(value or "0"))
    comma = text.rfind(",")
    dot = text.rfind(".")

    if comma >= 0 and dot >= 0:
        decimal_separator = "," if comma > dot else "."
        grouping_separator = "." if decimal_separator == "," else ","
        text = text.replace(grouping_separator, "")
        if decimal_separator == ",":
            text = text.replace(",", ".")
    elif comma >= 0:
        if re.search(r",\d{1,2}$", text):
            text = text.replace(",", ".")
        else:
            text = text.replace(",", "")
    elif text.count(".") > 1:
        last_dot = text.rfind(".")
        text = text[:last_dot].replace(".", "") + text[last_dot:]

    try:
        price = float(text)
    except ValueError:
        return 0.0
    return price if price >= 0 else 0.0


def resolve_image(item: dict[str, object], title: str) -> str:
    image = str(item.get("Imagen") or "").strip()
    if not image or "imgur.com/a/" in image or not image.lower().startswith(("http://", "https://")):
        image = f"img/products/{title}.png"
    elif "imgur.com" in image and not image.endswith((".jpg", ".png")):
        image += ".jpg"
    return urljoin(SITE_URL, image)


def normalize_catalog(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    products: list[dict[str, object]] = []
    used_slugs: set[str] = set()

    for row in rows:
        title = str(row.get("Titulo") or "Producto sin nombre").strip()
        if not title:
            continue

        raw_disp = str(row.get("Disponible?") or row.get("Disponible") or "").strip().lower()
        if raw_disp in ("no", "0", "false", "inactivo", "oculto"):
            continue

        condition = str(row.get("Condicion") or "General").strip() or "General"
        raw_stock = str(row.get("Stock?") or row.get("Stock") or "").strip()
        stock_num = 0
        try:
            stock_num = int(float(raw_stock)) if raw_stock else 0
        except ValueError:
            stock_num = 0
        has_stock = stock_num >= 1
        base_slug = slugify(title)
        slug = base_slug
        if slug in used_slugs:
            slug = f"{base_slug}-{slugify(condition)}"
        suffix = 2
        while slug in used_slugs:
            slug = f"{base_slug}-{slugify(condition)}-{suffix}"
            suffix += 1
        used_slugs.add(slug)

        description = str(row.get("Descripcion") or "Sin descripción disponible.").replace("\r\n", "\n").replace("\r", "\n").strip()
        detail_lines = [
            line for line in description.split("\n")
            if not re.match(r"^\s*condici[oó]n\s*:", line, flags=re.IGNORECASE)
        ]
        description = "\n".join(detail_lines).strip() or "Consulta los detalles del producto por WhatsApp."
        products.append(
            {
                "slug": slug,
                "url": f"{PRODUCTS_PATH}{slug}.html",
                "name": title,
                "condition": condition,
                "price": parse_price(row.get("Precio")),
                "image": resolve_image(row, title),
                "description": description,
                "has_stock": has_stock,
                "stock_count": stock_num,
            }
        )

    if not products:
        raise ValueError("The Google Sheets catalog contains no products; leaving generated pages untouched.")
    return products


def description_html(description: str) -> str:
    paragraphs = re.split(r"\n\s*\n", description)
    rendered = []
    for paragraph in paragraphs:
        lines = [escape(line.strip()) for line in paragraph.splitlines() if line.strip()]
        if lines:
            line_breaks = "<br>\n".join(lines)
            rendered.append(f"<p>{line_breaks}</p>")
    return "\n".join(rendered) or "<p>Consulta los detalles del producto por WhatsApp.</p>"


def meta_description(product: dict[str, object]) -> str:
    details = re.sub(r"\s+", " ", str(product["description"])).strip()
    description = f'Comprar {product["name"]} en Venezuela y Barinas. ${product["price"]:.2f} USD en PC Factory. '
    description += details or "Envíos nacionales y entrega garantizada por WhatsApp."
    if len(description) > 160:
        description = description[:157].rsplit(" ", 1)[0] + "..."
    return description


def json_ld(value: dict[str, object]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def product_schema(product: dict[str, object]) -> dict[str, object]:
    condition = str(product["condition"]).strip().lower()
    item_condition = None
    if condition.startswith(("nuevo", "new")):
        item_condition = "https://schema.org/NewCondition"
    elif condition.startswith(("usado", "used", "seminuevo")):
        item_condition = "https://schema.org/UsedCondition"

    schema: dict[str, object] = {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": product["name"],
        "description": product["description"],
        "image": [product["image"]],
        "url": urljoin(SITE_URL, str(product["url"])),
        "offers": {
            "@type": "Offer",
            "url": urljoin(SITE_URL, str(product["url"])),
            "priceCurrency": "USD",
            "price": f'{product["price"]:.2f}',
            "availability": "https://schema.org/InStock" if product.get("has_stock") else "https://schema.org/PreOrder",
            "areaServed": [
                {"@type": "City", "name": "Barinas"},
                {"@type": "Country", "name": "Venezuela"}
            ],
            "seller": {
                "@type": "ElectronicsStore",
                "name": "PC Factory",
                "url": SITE_URL,
            },
        },
    }
    if item_condition:
        schema["itemCondition"] = item_condition
    return schema


def render_product_page(product: dict[str, object]) -> str:
    name = escape(product["name"])
    condition = escape(product["condition"])
    description = str(product["description"])
    page_url = urljoin(SITE_URL, str(product["url"]))
    image_url = str(product["image"])
    image = escape(image_url)
    title = f'{name} en Barinas y Venezuela | PC Factory'
    summary = escape(meta_description(product))
    has_stock = bool(product.get("has_stock"))
    if has_stock:
        availability_label = "Disponible · Entrega inmediata o nacional"
        availability_badge = f"{condition} · En inventario"
        whatsapp_msg = f'Hola PC Factory, me interesa comprar {product["name"]} (disponible en inventario).'
    else:
        availability_label = "Bajo pedido · Proveedor garantizado"
        availability_badge = f"{condition} · Bajo pedido"
        whatsapp_msg = f'Hola PC Factory, quiero consultar pedido y tiempo de entrega de {product["name"]}.'
    message = quote(whatsapp_msg)
    whatsapp_url = f"https://wa.me/584245945666?text={message}"

    schema = json_ld(product_schema(product))
    breadcrumb = json_ld(
        {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Inicio", "item": SITE_URL},
                {
                    "@type": "ListItem",
                    "position": 2,
                    "name": product["name"],
                    "item": page_url,
                },
            ],
        }
    )

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escape(title)}</title>
    <meta name="description" content="{summary}">
    <meta name="robots" content="index, follow">
    <meta name="theme-color" content="#000000">
    <link rel="canonical" href="{escape(page_url)}">
    <link rel="icon" type="image/svg+xml" href="../favicon/favicon.svg">
    <link rel="stylesheet" href="../css/style.css">
    <link rel="stylesheet" href="../css/product.css">
    <meta property="og:type" content="product">
    <meta property="og:site_name" content="PC Factory">
    <meta property="og:locale" content="es_VE">
    <meta property="og:title" content="{escape(title)}">
    <meta property="og:description" content="{summary}">
    <meta property="og:url" content="{escape(page_url)}">
    <meta property="og:image" content="{image}">
    <meta property="og:image:alt" content="{name}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="{escape(title)}">
    <meta name="twitter:description" content="{summary}">
    <meta name="twitter:image" content="{image}">
    <script type="application/ld+json">{schema}</script>
    <script type="application/ld+json">{breadcrumb}</script>
</head>
<body>
    <header class="product-header">
        <a href="../" aria-label="PC Factory, volver al inicio">
            <img src="../Isotipo.png" alt="PC Factory" width="50" height="50">
        </a>
        <a class="product-back-link" href="../#catalogo">Volver al catálogo</a>
    </header>
    <main class="product-detail-page">
        <nav class="product-breadcrumbs" aria-label="Ruta de navegación">
            <a href="../">Inicio</a>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{name}</span>
        </nav>
        <article class="product-detail-card">
            <div class="product-detail-image">
                <img src="{image}" alt="{name}" fetchpriority="high">
            </div>
            <div class="product-detail-info">
                <p class="product-detail-condition">{availability_badge}</p>
                <h1>{name}</h1>
                <p class="product-detail-price">${product["price"]:.2f} <span>USD</span></p>
                <p class="product-detail-note">Consulta por WhatsApp la disponibilidad, forma de pago y opciones de envío antes de confirmar tu compra.</p>
                <a class="btn btn-primary product-whatsapp" href="{escape(whatsapp_url)}" target="_blank" rel="noopener noreferrer">Consultar este producto por WhatsApp</a>
                <button type="button" class="product-share-btn" id="share-btn" data-title="{escape(name)}" data-text="{summary}" data-url="{escape(page_url)}">
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>
                    </svg>
                    <span id="share-btn-text">Compartir producto</span>
                </button>
                <a class="product-detail-back" href="../#catalogo">Seguir explorando el catálogo</a>
            </div>
        </article>
        <section class="product-description" aria-labelledby="product-description-title">
            <h2 id="product-description-title">Detalles del producto</h2>
            {description_html(description)}
        </section>
    </main>
    <footer class="product-footer">
        <p>PC Factory · Barinas, Venezuela · Envíos a todo el país</p>
        <a href="../#catalogo">Ver más productos</a>
    </footer>

    <script>
        const shareBtn = document.getElementById('share-btn');
        if (shareBtn) {{
            shareBtn.addEventListener('click', async () => {{
                const title = shareBtn.dataset.title;
                const text = shareBtn.dataset.text;
                const url = shareBtn.dataset.url || window.location.href;
                const btnText = document.getElementById('share-btn-text');

                if (navigator.share) {{
                    try {{
                        await navigator.share({{ title, text, url }});
                        return;
                    }} catch (err) {{
                        if (err.name !== 'AbortError') console.log(err);
                    }}
                }}

                try {{
                    await navigator.clipboard.writeText(url);
                    const originalText = btnText.textContent;
                    btnText.textContent = '¡Enlace copiado!';
                    shareBtn.style.borderColor = '#22c55e';
                    setTimeout(() => {{
                        btnText.textContent = originalText;
                        shareBtn.style.borderColor = '';
                    }}, 2500);
                }} catch (e) {{
                    prompt('Copia este enlace para compartir:', url);
                }}
            }});
        }}
    </script>
</body>
</html>
"""


def render_catalog_card(product: dict[str, object]) -> str:
    name = escape(product["name"])
    condition = escape(product["condition"])
    url = escape(product["url"])
    image = escape(product["image"])
    return f"""<article class="product-card glass-panel">
    <a class="product-image-container product-static-image" href="{url}" aria-label="Ver detalles de {name}">
        <img src="{image}" alt="{name}" class="product-image" loading="lazy">
        <span class="product-category">{condition}</span>
    </a>
    <div class="product-info">
        <h3 class="product-name">{name}</h3>
        <p class="product-availability">{"Disponible · Entrega inmediata o nacional" if product.get("has_stock") else "Bajo pedido · Proveedor garantizado"}</p>
        <div class="product-footer">
            <span class="product-price">${product["price"]:.2f}</span>
            <a class="btn btn-primary" href="{url}">Ver ficha del producto</a>
        </div>
    </div>
</article>"""


def update_homepage(products: list[dict[str, object]], index_path: Path = INDEX_PATH) -> bool:
    content = index_path.read_text(encoding="utf-8")
    pattern = re.compile(
        rf"{re.escape(START_MARKER)}.*?{re.escape(END_MARKER)}",
        flags=re.DOTALL,
    )
    replacement = (
        f"{START_MARKER}\n"
        + "\n".join(render_catalog_card(product) for product in products)
        + f"\n{END_MARKER}"
    )
    updated, count = pattern.subn(lambda _: replacement, content, count=1)
    if count != 1:
        raise ValueError("Could not find the generated product card markers in index.html.")
    if updated != content:
        index_path.write_text(updated, encoding="utf-8", newline="\n")
        return True
    return False


def update_sitemap(
    products: list[dict[str, object]],
    sitemap_path: Path = SITEMAP_PATH,
    changed_pages: set[str] | None = None,
    homepage_changed: bool = False,
) -> None:
    ET.register_namespace("", SITEMAP_NAMESPACE)
    changed_pages = changed_pages or set()
    current_date = datetime.now(timezone.utc).date().isoformat()
    if sitemap_path.exists():
        tree = ET.parse(sitemap_path)
        root = tree.getroot()
    else:
        root = ET.Element(f"{{{SITEMAP_NAMESPACE}}}urlset")
        tree = ET.ElementTree(root)

    url_tag = f"{{{SITEMAP_NAMESPACE}}}url"
    loc_tag = f"{{{SITEMAP_NAMESPACE}}}loc"
    lastmod_tag = f"{{{SITEMAP_NAMESPACE}}}lastmod"
    product_urls = {
        urljoin(SITE_URL, str(product["url"])): product
        for product in products
    }
    seen_urls: set[str] = set()
    for entry in list(root):
        location = entry.findtext(loc_tag, default="")
        if location.startswith(urljoin(SITE_URL, PRODUCTS_PATH)):
            if location not in product_urls:
                root.remove(entry)
                continue
            seen_urls.add(location)
        elif location.endswith("envios-venezuela.html"):
            pass
        elif location == SITE_URL and homepage_changed:
            lastmod = entry.find(lastmod_tag)
            if lastmod is None:
                lastmod = ET.SubElement(entry, lastmod_tag)
            lastmod.text = current_date

        if location in changed_pages:
            lastmod = entry.find(lastmod_tag)
            if lastmod is None:
                lastmod = ET.SubElement(entry, lastmod_tag)
            lastmod.text = current_date

    for product in products:
        location = urljoin(SITE_URL, str(product["url"]))
        if location in seen_urls:
            continue
        entry = ET.SubElement(root, url_tag)
        ET.SubElement(entry, loc_tag).text = location
        ET.SubElement(entry, lastmod_tag).text = current_date

    ET.indent(tree, space="  ")
    tree.write(sitemap_path, encoding="utf-8", xml_declaration=True)


def write_generated_pages(products: list[dict[str, object]], root: Path = ROOT) -> set[str]:
    products_dir = root / PRODUCTS_PATH
    products_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = products_dir / MANIFEST_NAME

    previous_pages: list[str] = []
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(previous, list) or not all(
            isinstance(name, str) and Path(name).name == name and name.endswith(".html")
            for name in previous
        ):
            raise ValueError(f"Invalid generated-page manifest: {manifest_path}")
        previous_pages = previous

    current_pages = [f'{product["slug"]}.html' for product in products]
    changed_pages: set[str] = set()
    for product in products:
        page_path = products_dir / f'{product["slug"]}.html'
        page_content = render_product_page(product)
        if not page_path.exists() or page_path.read_text(encoding="utf-8") != page_content:
            page_path.write_text(page_content, encoding="utf-8", newline="\n")
            changed_pages.add(urljoin(SITE_URL, str(product["url"])))

    for stale_page in set(previous_pages) - set(current_pages):
        (products_dir / stale_page).unlink(missing_ok=True)

    manifest_path.write_text(
        json.dumps(sorted(current_pages), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return changed_pages


def fetch_catalog() -> list[dict[str, object]]:
    app_source = APP_PATH.read_text(encoding="utf-8")
    matches = re.findall(
        r'const\s+GOOGLE_APP_SCRIPT_URL\s*=\s*["\']([^"\']+)["\']',
        app_source,
    )
    if len(matches) != 1:
        raise ValueError("Expected exactly one Google Apps Script URL in js/app.js.")

    request = Request(matches[0], headers={"User-Agent": "PCFactoryProductPages/1.0"})
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (URLError, TimeoutError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not load the product catalog: {error}") from error

    if not isinstance(payload, list) or not all(isinstance(row, dict) for row in payload):
        raise ValueError("The product catalog must be a JSON array of objects.")
    return payload


def generate(products_data: list[dict[str, object]], root: Path = ROOT) -> int:
    products = normalize_catalog(products_data)
    changed_pages = write_generated_pages(products, root)
    homepage_changed = update_homepage(products, root / "index.html")
    update_sitemap(products, root / "sitemap.xml", changed_pages, homepage_changed)
    return len(products)


def main() -> None:
    count = generate(fetch_catalog())
    print(f"Generated {count} product pages and updated the homepage and sitemap.")


if __name__ == "__main__":
    main()
