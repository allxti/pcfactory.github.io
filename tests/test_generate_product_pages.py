import importlib.util
import json
import re
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "generate_product_pages.py"
SPEC = importlib.util.spec_from_file_location("generate_product_pages", SCRIPT_PATH)
generator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(generator)


class ProductPageGeneratorTests(unittest.TestCase):
    def test_normalizes_product_urls_and_duplicate_names(self):
        products = generator.normalize_catalog(
            [
                {"Titulo": "Memoría RAM 8GB", "Condicion": "Nuevo", "Precio": "$1,299.99"},
                {"Titulo": "Memoría RAM 8GB", "Condicion": "Usado", "Precio": "1.299,99"},
                {"Titulo": "Memoría RAM 8GB", "Condicion": "Usado", "Precio": "1299,99"},
            ]
        )

        self.assertEqual(
            [product["url"] for product in products],
            [
                "productos/memoria-ram-8gb.html",
                "productos/memoria-ram-8gb-usado.html",
                "productos/memoria-ram-8gb-usado-2.html",
            ],
        )
        self.assertEqual([product["price"] for product in products], [1299.99] * 3)

    def test_normalizes_non_ascii_product_names_into_stable_slugs(self):
        products = generator.normalize_catalog(
            [
                {"Titulo": "Memoría Straße / USB", "Condicion": "Nuevo", "Precio": 20}
            ]
        )
        self.assertEqual(products[0]["url"], "productos/memoria-strasse-usb.html")

    def test_product_page_has_canonical_offer_and_escaped_sheet_content(self):
        product = generator.normalize_catalog(
            [
                {
                    "Titulo": 'Laptop <script>alert("x")</script>',
                    "Condicion": "Nuevo",
                    "Precio": 20,
                    "Imagen": "https://example.com/image.jpg",
                    "Descripcion": "Línea 1\n\nLínea 2 <img src=x onerror=alert(1)>",
                }
            ]
        )[0]
        page = generator.render_product_page(product)
        schemas = [
            json.loads(block)
            for block in re.findall(
                r'<script type="application/ld\+json">(.*?)</script>',
                page,
            )
        ]

        self.assertIn('rel="canonical" href="https://pcfactory.site/productos/', page)
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("&lt;img", page)
        self.assertNotIn("<img src=x onerror=alert(1)>", page)
        self.assertNotIn("Condición:", page)
        self.assertEqual(schemas[0]["@type"], "Product")
        self.assertEqual(schemas[0]["offers"]["priceCurrency"], "USD")

    def test_removes_sheet_condition_line_from_product_description(self):
        product = generator.normalize_catalog(
            [
                {
                    "Titulo": "Memoria RAM",
                    "Condicion": "Usado",
                    "Precio": 20,
                    "Descripcion": "Marca: Micron\nCondición: Nuevo de paquete en su caja.",
                }
            ]
        )[0]

        page = generator.render_product_page(product)
        self.assertIn("Usado · Bajo pedido", page)
        self.assertIn("<p>Marca: Micron</p>", page)
        self.assertNotIn("Nuevo de paquete", page)

    def test_generate_updates_static_cards_sitemap_and_removes_only_stale_generated_pages(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "index.html").write_text(
                f"<div id=\"product-grid\">{generator.START_MARKER}{generator.END_MARKER}</div>",
                encoding="utf-8",
            )
            (root / "sitemap.xml").write_text(
                '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                "<url><loc>https://pcfactory.site/</loc></url></urlset>",
                encoding="utf-8",
            )
            products = [
                {"Titulo": "Fuente de poder", "Condicion": "Nuevo", "Precio": 20, "Descripcion": "600W"}
            ]
            generator.generate(products, root)
            generated_file = root / "productos" / "fuente-de-poder.html"
            manual_file = root / "productos" / "manual.html"
            manual_file.write_text("keep", encoding="utf-8")
            self.assertTrue(generated_file.exists())
            self.assertIn('href="productos/fuente-de-poder.html"', (root / "index.html").read_text(encoding="utf-8"))

            fixed_now = generator.datetime(2026, 11, 7, tzinfo=generator.timezone.utc)
            with patch.object(generator, "datetime", wraps=generator.datetime) as mocked_datetime:
                mocked_datetime.now.return_value = fixed_now
                generator.generate(
                    [{"Titulo": "Memoria RAM", "Condicion": "Usado", "Precio": 30}],
                    root,
                )
            self.assertFalse(generated_file.exists())
            self.assertTrue(manual_file.exists())
            sitemap = ET.parse(root / "sitemap.xml")
            locations = [
                node.text
                for node in sitemap.getroot().iter()
                if node.tag.endswith("loc")
            ]
            self.assertEqual(
                locations,
                ["https://pcfactory.site/", "https://pcfactory.site/productos/memoria-ram.html"],
            )
            root = sitemap.getroot()
            lastmod_dates = [
                node.text
                for node in root.iter()
                if node.tag.endswith("lastmod")
            ]
            self.assertEqual(lastmod_dates, [fixed_now.date().isoformat()] * 2)

    def test_repeated_generation_does_not_change_lastmod_or_files(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "index.html").write_text(
                f"{generator.START_MARKER}{generator.END_MARKER}",
                encoding="utf-8",
            )
            product = [{"Titulo": "Mouse Gamer", "Condicion": "Nuevo", "Precio": 20}]
            fixed_now = generator.datetime(2026, 11, 7, tzinfo=generator.timezone.utc)
            with patch.object(generator, "datetime", wraps=generator.datetime) as mocked_datetime:
                mocked_datetime.now.return_value = fixed_now
                generator.generate(product, root)
                first_run = {
                    path.relative_to(root).as_posix(): path.read_bytes()
                    for path in root.rglob("*")
                    if path.is_file()
                }
                generator.generate(product, root)
                second_run = {
                    path.relative_to(root).as_posix(): path.read_bytes()
                    for path in root.rglob("*")
                    if path.is_file()
                }
            self.assertEqual(first_run, second_run)

    def test_empty_catalog_does_not_remove_existing_generated_pages(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "index.html").write_text(
                f"{generator.START_MARKER}{generator.END_MARKER}",
                encoding="utf-8",
            )
            generated_file = root / "productos" / "keep.html"
            generated_file.parent.mkdir()
            generated_file.write_text("keep", encoding="utf-8")

            with self.assertRaises(ValueError):
                generator.generate([], root)
            self.assertEqual(generated_file.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
