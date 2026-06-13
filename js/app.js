// js/app.js
document.addEventListener('DOMContentLoaded', () => {
    const productGrid = document.getElementById('product-grid');
    const cartCount = document.getElementById('cart-count');
    const cartModal = document.getElementById('cart-modal');
    const closeCartBtn = document.getElementById('close-cart');
    const cartItemsContainer = document.getElementById('cart-items');
    const cartTotalEl = document.getElementById('cart-total');
    const cartToggleBtn = document.getElementById('cart-toggle');

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

    // IMPORTANTE: Pega aquí la URL que te dio Google Apps Script al publicar
    const GOOGLE_APP_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyADbm77LHiia9Satb5oux13TOifIzExAtowYQLJuHSKSlYci-5-uX6QCO0FldZvr5U7w/exec";

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
        return data.map((item, index) => {
            let rawPrice = item.Precio || "0";
            let priceValue = parseFloat(String(rawPrice).replace(/[^\d.-]/g, '')) || 0;
            
            let imgUrl = item.Imagen || "";
            
            if (!imgUrl || imgUrl.includes("imgur.com/a/") || !imgUrl.startsWith("http")) {
                let safeTitle = (item.Titulo || "default").trim();
                imgUrl = `img/products/${safeTitle}.png`;
            } else if (imgUrl.includes("imgur.com") && !imgUrl.endsWith(".jpg") && !imgUrl.endsWith(".png")) {
                imgUrl += ".jpg";
            }

            let desc = (item.Descripcion || "Sin descripción disponible.").replace(/\n/g, '<br>');

            return {
                id: "gs_" + index,
                category: item.Condicion || "General",
                name: item.Titulo || "Producto sin nombre",
                price: priceValue,
                image: imgUrl,
                description: desc
            };
        });
    }

    async function loadCatalog() {
        // Mostrar loader inicial solo si no hay caché
        const cachedData = sessionStorage.getItem('pcfactory_catalog');
        if (cachedData) {
            catalog = JSON.parse(cachedData);
            renderProducts();
            
            // Refrescar en background silenciosamente
            fetch(GOOGLE_APP_SCRIPT_URL)
                .then(res => res.json())
                .then(data => {
                    const freshCatalog = processData(data);
                    sessionStorage.setItem('pcfactory_catalog', JSON.stringify(freshCatalog));
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
            sessionStorage.setItem('pcfactory_catalog', JSON.stringify(catalog));
            
            renderProducts();

        } catch (err) {
            console.error("Error cargando desde Apps Script:", err);
            productGrid.innerHTML = '<div class="error-msg" style="grid-column: 1/-1; text-align: center; color: red;">Error de conexión. Asegúrate de que la URL del script sea correcta.</div>';
        }
    }

    // Renderizar Productos
    function renderProducts() {
        productGrid.innerHTML = '';
        if (catalog.length === 0) {
            productGrid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; color: var(--text-secondary);">No hay productos disponibles por el momento.</p>';
            return;
        }

        catalog.forEach(product => {
            const card = document.createElement('div');
            card.className = 'product-card glass-panel';
            card.innerHTML = `
                <div class="product-image-container" data-id="${product.id}">
                    <img src="${product.image}" alt="${product.name}" class="product-image" loading="lazy">
                    <span class="product-category">${product.category}</span>
                </div>
                <div class="product-info">
                    <h3 class="product-name">${product.name}</h3>
                    <div class="product-footer">
                        <span class="product-price">$${product.price.toFixed(2)}</span>
                        <button class="btn btn-primary add-to-cart" data-id="${product.id}">
                            <span>Añadir al Carrito</span>
                        </button>
                    </div>
                </div>
            `;
            productGrid.appendChild(card);
        });

        // Event Listeners for Product Preview (Image Click)
        document.querySelectorAll('.product-image-container').forEach(container => {
            container.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                openPreview(id);
            });
        });

        // Event Listeners for "Add to Cart"
        document.querySelectorAll('.add-to-cart').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                addToCart(id);
                // Animación de feedback
                const btnEl = e.currentTarget;
                const originalText = btnEl.innerHTML;
                btnEl.innerHTML = `<span>¡Añadido!</span>`;
                btnEl.classList.add('added');
                setTimeout(() => {
                    btnEl.innerHTML = originalText;
                    btnEl.classList.remove('added');
                }, 1500);
            });
        });
    }

    // Lógica de Vista Previa (Modal)
    function openPreview(id) {
        const product = catalog.find(p => p.id === id);
        if(!product) return;

        previewImg.src = product.image;
        previewImg.alt = product.name;
        previewTitle.textContent = product.name;
        previewDesc.innerHTML = product.description;
        previewPrice.textContent = `$${product.price.toFixed(2)}`;
        
        // Actualizar botón de añadir del modal
        previewAddCartBtn.setAttribute('data-id', product.id);
        
        previewModal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    closePreviewBtn.addEventListener('click', () => {
        previewModal.classList.remove('open');
        document.body.style.overflow = '';
    });

    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) {
            previewModal.classList.remove('open');
            document.body.style.overflow = '';
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
            previewModal.classList.remove('open');
            document.body.style.overflow = '';
        }, 1000);
    });

    // Lógica del Carrito
    function addToCart(id) {
        const product = catalog.find(p => p.id === id);
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
                    <img src="${item.image}" alt="${item.name}">
                    <div class="cart-item-info">
                        <h4>${item.name}</h4>
                        <p>$${item.price.toFixed(2)} x ${item.quantity}</p>
                    </div>
                    <button class="remove-item" data-id="${item.id}">&times;</button>
                `;
                cartItemsContainer.appendChild(itemEl);
            });
        }

        cartTotalEl.textContent = `$${total.toFixed(2)}`;

        document.querySelectorAll('.remove-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.currentTarget.getAttribute('data-id');
                removeFromCart(id);
            });
        });
    }

    // Modal Events
    cartToggleBtn.addEventListener('click', () => {
        cartModal.classList.add('open');
        document.body.style.overflow = 'hidden'; // Evitar scroll
        document.body.classList.add('cart-open');
    });

    closeCartBtn.addEventListener('click', () => {
        cartModal.classList.remove('open');
        document.body.style.overflow = '';
        document.body.classList.remove('cart-open');
    });

    // Cerrar al clickear fuera
    cartModal.addEventListener('click', (e) => {
        if (e.target === cartModal) {
            cartModal.classList.remove('open');
            document.body.style.overflow = '';
            document.body.classList.remove('cart-open');
        }
    });
    
    // WhatsApp Checkout
    checkoutBtn.addEventListener('click', () => {
        if (cart.length === 0) return;
        
        let text = "¡Hola PC Factory! Quiero realizar el siguiente pedido:\n\n";
        let total = 0;
        
        cart.forEach(item => {
            text += `- ${item.quantity}x ${item.name} ($${item.price.toFixed(2)})\n`;
            total += item.price * item.quantity;
        });
        
        text += `\n*Total a pagar: $${total.toFixed(2)}*`;
        
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
