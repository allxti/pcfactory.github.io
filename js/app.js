// js/app.js
document.addEventListener('DOMContentLoaded', () => {
    const productGrid = document.getElementById('product-grid');
    const cartCount = document.getElementById('cart-count');
    const cartModal = document.getElementById('cart-modal');
    const closeCartBtn = document.getElementById('close-cart');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalEl = document.getElementById('cart-total');
    const cartToggleBtn = document.getElementById('cart-toggle');
    const catalogSearch = document.getElementById('catalog-search');
    const conditionFilter = document.getElementById('condition-filter');
    const catalogResultCount = document.getElementById('catalog-result-count');

    // Elementos del Modal de Vista Previa
    const previewModal = document.getElementById('preview-modal');
    const closePreviewBtn = document.getElementById('close-preview');
    const previewImg = document.getElementById('preview-img');
    const previewTitle = document.getElementById('preview-title');
    const previewDesc = document.getElementById('preview-desc');
    const previewPrice = document.getElementById('preview-price');
    const previewAddCartBtn = document.getElementById('preview-add-cart');
    
    const checkoutBtn = document.getElementById('checkout-btn');

    let catalog = [];
    let cart = JSON.parse(localStorage.getItem('pc_factory_cart')) || [];
    let previewReturnFocus = null;

    // IMPORTANTE: Pega aquí la URL que te dio Google Apps Script al publicar
    const GOOGLE_APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyADbm77LHiia9Satb5oux13TOifIzExAtowYQLJuHSKSlYci-5-uX6QCO0FldZvr5U7w/exec";
    const CATALOG_CACHE_KEY = 'pcfactory_catalog_v3';

    function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function normalizeSearchText(value) {
        return String(value).toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function slugifyProductPart(value) {
        return normalizeSearchText(value.replace(/ß/g, 'ss'))
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'producto';
    }

    function parsePrice(value) {
        let text = String(value || '0').replace(/[^\d,.-]/g, '');
        const comma = text.lastIndexOf(',');
        const dot = text.lastIndexOf('.');

        if (comma >= 0 && dot >= 0) {
            const decimalSeparator = comma > dot ? ',' : '.';
            const groupingSeparator = decimalSeparator === ',' ? /\./g : /,/g;
            text = text.replace(groupingSeparator, '');
            if (decimalSeparator === ',') text = text.replace(',', '.');
        } else if (comma >= 0) {
            text = /,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
        } else if ((text.match(/\./g) || []).length > 1) {
            const lastDot = text.lastIndexOf('.');
            text = text.slice(0, lastDot).replace(/\./g, '') + text.slice(lastDot);
        }

        const price = Number(text);
        return Number.isFinite(price) && price >= 0 ? price : 0;
    }

    // Tasas de Cambio en Tiempo Real
    const exchangeRatesEl = document.getElementById('exchange-rates');

    async function loadExchangeRates() {
        try {
            const response = await fetch('https://ve.dolarapi.com/v1/dolares');
            if (!response.ok) throw new Error('Error al obtener tasas');
            const data = await response.json();

            const bcv = data.find(d => d.fuente === 'oficial');
            const paralelo = data.find(d => d.fuente === 'paralelo');

            const bcvRate = bcv ? bcv.promedio.toFixed(2) : '---';
            const paraleloRate = paralelo ? paralelo.promedio.toFixed(2) : '---';

            exchangeRatesEl.innerHTML = `
                <div class="rate-item">
                    <span class="rate-label">BCV</span>
                    <span class="rate-value bcv">Bs. ${bcvRate}</span>
                </div>
                <div class="rate-item">
                    <span class="rate-label">USDT</span>
                    <span class="rate-value">Bs. ${paraleloRate}</span>
                </div>
            `;
        } catch (err) {
            console.error('Error cargando tasas:', err);
            exchangeRatesEl.innerHTML = `
                <div class="rate-item">
                    <span class="rate-label">TASAS</span>
                    <span class="rate-value" style="color: var(--text-secondary);">No disponible</span>
                </div>
            `;
        }
    }

    function processData(data) {
        const usedSlugs = new Set();
        const activeData = data.filter(item => {
            const rawDisp = String(item["Disponible?"] || item.Disponible || "").trim().toLowerCase();
            return !["no", "0", "false", "inactivo", "oculto"].includes(rawDisp);
        });
        return activeData.map((item, index) => {
            const priceValue = parsePrice(item.Precio);
            
            let imgUrl = item.Imagen || "";
            
            if (!imgUrl || imgUrl.includes("imgur.com/a/") || !/^https?:\/\//i.test(imgUrl)) {
                let safeTitle = (item.Titulo || "Producto sin nombre").trim() || "Producto sin nombre";
                imgUrl = `img/products/${safeTitle}.png`;
            } else if (imgUrl.includes("imgur.com") && !imgUrl.endsWith(".jpg") && !imgUrl.endsWith(".png")) {
                imgUrl += ".jpg";
            }

            let desc = (item.Descripcion || "Sin descripción disponible.").replace(/\r\n?/g, '\n');
            const name = String(item.Titulo || "Producto sin nombre").trim() || "Producto sin nombre";
            const rawStock = String(item["Stock?"] || item.Stock || "").trim();
            const stockNum = parseFloat(rawStock);
            const hasStock = !isNaN(stockNum) && stockNum >= 1;
            const category = String(item.Condicion || "General").trim() || "General";
            const baseSlug = slugifyProductPart(name);
            let slug = baseSlug;

            if (usedSlugs.has(slug)) {
                slug = `${baseSlug}-${slugifyProductPart(category)}`;
            }
            let duplicate = 2;
            while (usedSlugs.has(slug)) {
                slug = `${baseSlug}-${slugifyProductPart(category)}-${duplicate}`;
                duplicate += 1;
            }
            usedSlugs.add(slug);
            return {
                id: "gs_" + index,
                category,
                name,
                price: priceValue,
                image: imgUrl,
                description: desc,
                hasStock: hasStock,
                stockCount: isNaN(stockNum) ? 0 : stockNum,
                url: `productos/${slug}.html`
            };
        });
    }

    async function loadCatalog() {
        // Mostrar loader inicial solo si no hay caché
        const cachedData = sessionStorage.getItem(CATALOG_CACHE_KEY);
        if (cachedData) {
            catalog = JSON.parse(cachedData);
            updateCategoryOptions();
            renderProducts();
            
            fetch(GOOGLE_APP_SCRIPT_URL)
                .then(res => {
                    if (!res.ok) throw new Error("Error en la respuesta del catálogo");
                    return res.json();
                })
                .then(data => {
                    const freshCatalog = processData(data);
                    sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(freshCatalog));
                    if (JSON.stringify(freshCatalog) !== JSON.stringify(catalog)) {
                        catalog = freshCatalog;
                        updateCategoryOptions();
                        renderProducts();
                    }
                }).catch(e => console.error("Fallo actualización en background", e));
            return;
        }

        productGrid.innerHTML = '<div class="loading" style="grid-column: 1/-1; text-align: center; padding: 3rem;">Cargando catálogo ultrarrápido...</div>';
        
        if (GOOGLE_APP_SCRIPT_URL === "PEGAR_AQUI_LA_URL_DE_TU_SCRIPT") {
            productGrid.innerHTML = '<div class="error-msg" style="grid-column: 1/-1; text-align: center; padding: 2rem; background: #fff3cd; color: #856404; border-radius: 12px;">Por favor, pega la URL de tu Google Apps Script en el archivo <b>js/app.js</b> para ver tus productos.</div>';
            return;
        }

        try {
            const response = await fetch(GOOGLE_APP_SCRIPT_URL);
            if (!response.ok) throw new Error("Error en la respuesta de la API");
            const data = await response.json();
            
            catalog = processData(data);
            sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog));
            
            updateCategoryOptions();
            renderProducts();

        } catch (err) {
            console.error("Error cargando desde Apps Script:", err);
            productGrid.innerHTML = '<div class="error-msg" style="grid-column: 1/-1; text-align: center; color: red;">Error de conexión. Asegúrate de que la URL del script sea correcta.</div>';
        }
    }

    // Renderizar Productos
    function renderProducts() {
        productGrid.innerHTML = '';
        const query = normalizeSearchText(catalogSearch.value.trim());
        const selectedCategory = conditionFilter.value;
        const filteredCatalog = catalog.filter(product => {
            const searchableText = normalizeSearchText(`${product.name} ${product.category} ${product.description}`);
            return (!query || searchableText.includes(query))
                && (!selectedCategory || product.category === selectedCategory);
        });

        catalogResultCount.textContent = filteredCatalog.length === catalog.length
            ? `${catalog.length} ${catalog.length === 1 ? 'producto en el catálogo' : 'productos en el catálogo'}`
            : `${filteredCatalog.length} ${filteredCatalog.length === 1 ? 'resultado' : 'resultados'}`;

        if (catalog.length === 0) {
            productGrid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color: var(--text-secondary);">No hay productos disponibles por el momento.</p>';
            return;
        }

        if (filteredCatalog.length === 0) {
            productGrid.innerHTML = '<p class="empty-cart" style="grid-column: 1/-1;">No encontramos productos con esos filtros. Prueba otra búsqueda o escríbenos por WhatsApp.</p>';
            return;
        }

        filteredCatalog.forEach(product => {
            const card = document.createElement('div');
            card.className = 'product-card glass-panel';
            card.innerHTML = `
                <button class="product-image-container" type="button" data-id="${escapeHTML(product.id)}" aria-label="Ver detalles de ${escapeHTML(product.name)}">
                    <img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.name)}" class="product-image" loading="lazy">
                    <span class="product-category">${escapeHTML(product.category)}</span>
                </button>
                <div class="product-info">
                    <h3 class="product-name">${escapeHTML(product.name)}</h3>
                    <p class="product-availability">${product.hasStock ? '🟢 Disponible · Entrega inmediata o nacional' : '📦 Bajo pedido · Proveedor garantizado'}</p>
                    <div class="product-footer">
                        <span class="product-price">$${product.price.toFixed(2)}</span>
                        <button class="btn btn-primary add-to-cart" data-id="${escapeHTML(product.id)}">
                            <span>Agregar al pedido</span>
                        </button>
                        <a class="product-details-link" href="${escapeHTML(product.url)}">Ver ficha del producto</a>
                    </div>
                </div>
            `;
            productGrid.appendChild(card);
        });

        // Event Listeners for Product Preview (Image Click)
        productGrid.querySelectorAll('.product-image-container').forEach(container => {
            container.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                openPreview(id);
            });
        });

        // Event Listeners for "Add to Cart"
        productGrid.querySelectorAll('.add-to-cart').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                addToCart(id);
                // Animación de feedback
                const btnEl = e.currentTarget;
                const originalText = btnEl.innerHTML;
                btnEl.textContent = 'Agregado al pedido';
                btnEl.classList.add('added');
                setTimeout(() => {
                    btnEl.innerHTML = originalText;
                    btnEl.classList.remove('added');
                }, 1500);
            });
        });
    }

    function updateCategoryOptions() {
        const selectedCategory = conditionFilter.value;
        const categories = [...new Set(catalog.map(product => product.category))].sort((a, b) => a.localeCompare(b, 'es'));
        conditionFilter.innerHTML = '<option value="">Todas las condiciones</option>';

        categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            conditionFilter.appendChild(option);
        });

        conditionFilter.value = categories.includes(selectedCategory) ? selectedCategory : '';
    }

    // Lógica de Vista Previa (Modal)
    function openPreview(id) {
        const product = catalog.find(p => p.id === id);
        if (!product) return;

        previewReturnFocus = document.activeElement;
        previewImg.src = product.image;
        previewImg.alt = product.name;
        previewTitle.textContent = product.name;
        previewDesc.innerHTML = escapeHTML(product.description).replace(/\r?\n/g, '<br>');
        previewPrice.textContent = `$${product.price.toFixed(2)}`;
        
        // Actualizar botón de añadir del modal
        previewAddCartBtn.setAttribute('data-id', product.id);
        
        previewModal.classList.add('open');
        previewModal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        closePreviewBtn.focus();
    }

    function closePreview() {
        previewModal.classList.remove('open');
        previewModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (previewReturnFocus) previewReturnFocus.focus();
    }

    closePreviewBtn.addEventListener('click', () => {
        closePreview();
    });

    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) {
            closePreview();
        }
    });

    previewAddCartBtn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        addToCart(id);
        const originalText = previewAddCartBtn.innerHTML;
        previewAddCartBtn.innerHTML = `<span>¡Añadido!</span>`;
        previewAddCartBtn.classList.add('added');
        setTimeout(() => {
            previewAddCartBtn.innerHTML = originalText;
            previewAddCartBtn.classList.remove('added');
            closePreview();
        }, 1000);
    });

    // Lógica del Carrito
    function addToCart(id) {
        const product = catalog.find(p => p.id === id);
        if (!product) return;
        const existingItem = cart.find(item => item.id === id);

        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            cart.push({ ...product, quantity: 1 });
        }
        updateCart();
    }

    function removeFromCart(id) {
        cart = cart.filter(item => item.id !== id);
        updateCart();
    }

    function updateCart() {
        localStorage.setItem('pc_factory_cart', JSON.stringify(cart));
        
        // Actualizar contador
        const totalItems = cart.reduce((acc, item) => acc + item.quantity, 0);
        cartCount.textContent = totalItems;
        checkoutBtn.disabled = totalItems === 0;
        cartToggleBtn.setAttribute('aria-label', `Abrir pedido, ${totalItems} ${totalItems === 1 ? 'producto' : 'productos'}`);
        if(totalItems > 0) {
            cartCount.classList.add('pulse-anim');
            setTimeout(() => cartCount.classList.remove('pulse-anim'), 300);
        }

        // Renderizar items del modal
        cartItemsContainer.innerHTML = '';
        let total = 0;

        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart">Tu carrito está vacío.</p>';
        } else {
            cart.forEach(item => {
                total += item.price * item.quantity;
                const itemEl = document.createElement('div');
                itemEl.className = 'cart-item';
                itemEl.innerHTML = `
                    <img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.name)}">
                    <div class="cart-item-info">
                        <h4>${escapeHTML(item.name)}</h4>
                        <p>$${item.price.toFixed(2)} x ${item.quantity}</p>
                    </div>
                    <button class="remove-item" data-id="${escapeHTML(item.id)}" aria-label="Quitar ${escapeHTML(item.name)} del pedido">&times;</button>
                `;
                cartItemsContainer.appendChild(itemEl);
            });
        }

        cartTotalEl.textContent = `$${total.toFixed(2)}`;

        cartItemsContainer.querySelectorAll('.remove-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                removeFromCart(id);
            });
        });
    }

    // Modal Events
    cartToggleBtn.addEventListener('click', () => {
        cartModal.classList.add('open');
        cartModal.setAttribute('aria-hidden', 'false');
        cartToggleBtn.setAttribute('aria-expanded', 'true');
        document.body.style.overflow = 'hidden'; // Evitar scroll
        document.body.classList.add('cart-open');
        closeCartBtn.focus();
    });

    function closeCart() {
        cartModal.classList.remove('open');
        cartModal.setAttribute('aria-hidden', 'true');
        cartToggleBtn.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
        document.body.classList.remove('cart-open');
        cartToggleBtn.focus();
    }

    closeCartBtn.addEventListener('click', () => {
        closeCart();
    });

    // Cerrar al clickear fuera
    cartModal.addEventListener('click', (e) => {
        if (e.target === cartModal) {
            closeCart();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (previewModal.classList.contains('open')) closePreview();
            else if (cartModal.classList.contains('open')) closeCart();
            return;
        }

        if (e.key !== 'Tab') return;
        const activeModal = previewModal.classList.contains('open')
            ? previewModal.querySelector('.preview-content')
            : cartModal.classList.contains('open') ? cartModal : null;
        if (!activeModal) return;

        const focusableElements = [...activeModal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (e.shiftKey && document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
        }
    });

    catalogSearch.addEventListener('input', renderProducts);
    conditionFilter.addEventListener('change', renderProducts);
    
    // WhatsApp Checkout
    checkoutBtn.addEventListener('click', () => {
        if (cart.length === 0) {
            cartItemsContainer.innerHTML = '<p class="empty-cart">Agrega un producto para preparar tu pedido.</p>';
            return;
        }
        
        let text = "¡Hola PC Factory! Quiero consultar disponibilidad y coordinar este pedido:\n\n";
        let total = 0;
        
        cart.forEach(item => {
            text += `- ${item.quantity}x ${item.name} ($${item.price.toFixed(2)})\n`;
            total += item.price * item.quantity;
        });
        
        text += `\n*Total de referencia: $${total.toFixed(2)}*`;
        text += "\n\n¿Me confirman disponibilidad, forma de pago y opciones de envío?";
        
        const waLink = `https://wa.me/584245945666?text=${encodeURIComponent(text)}`;
        window.open(waLink, '_blank');
    });

    // Inicializar
    loadCatalog();
    loadExchangeRates();
    updateCart();

    // Actualizar tasas cada 5 minutos
    setInterval(loadExchangeRates, 5 * 60 * 1000);
});
