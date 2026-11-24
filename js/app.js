const state = {
    user: null,
    products: [],
    workers: [],
    processes: [],
    movements: {},
    globalMethod: 'PEPS',
    isProcesosLocked: true,
    sessionId: `Sesión del ${new Date().toLocaleDateString('es-MX')} - ${new Date().toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}`
};

document.addEventListener('DOMContentLoaded', () => {
    // 1. LOGIN
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const user = document.getElementById('username').value;
            const pass = document.getElementById('password').value;

            if (user === 'admin' && pass === '1234') {
                state.user = user;
                document.getElementById('login-screen').classList.add('hidden');
                document.getElementById('app-screen').classList.remove('hidden');
                
                loadProductsFromFirebase();
                loadWorkersFromFirebase();
                loadProcessesFromFirebase();
                cargarMesPresupuesto();
            } else {
                document.getElementById('login-error').classList.remove('hidden');
            }
        });
    }

    document.getElementById('logout-btn')?.addEventListener('click', () => location.reload());

    // 2. CONFIGURACIÓN GENERAL
    document.getElementById('config-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        state.globalMethod = document.getElementById('cfg-metodo-global').value;
        const badge = document.getElementById('active-method-badge');
        if (badge) badge.innerText = `Método: ${state.globalMethod}`;
        
        renderAllCards();
        actualizarCedulaProducto();
        alert(`Configuración guardada. El método institucional de inventario ahora es ${state.globalMethod}.`);
    });

    // 3. OCULTAR COSTO EN SALIDAS
    const movTypeSelect = document.getElementById('mov-type');
    const costContainer = document.getElementById('cost-container');
    movTypeSelect?.addEventListener('change', (e) => {
        if (e.target.value === 'SALIDA') {
            costContainer?.classList.add('opacity-40', 'pointer-events-none');
            document.getElementById('mov-cost')?.removeAttribute('required');
        } else {
            costContainer?.classList.remove('opacity-40', 'pointer-events-none');
            document.getElementById('mov-cost')?.setAttribute('required', 'true');
        }
    });

    // 4. REGISTRO DE INSUMOS
    document.getElementById('product-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newProduct = {
            name: document.getElementById('prod-name').value.trim(),
            unit: document.getElementById('prod-unit').value.trim(),
            createdAt: new Date()
        };

        try {
            const docRef = await window.fs.addDoc(window.fs.collection(window.db, "productos"), newProduct);
            state.products.push({ id: docRef.id, ...newProduct });
            state.movements[docRef.id] = [];
            
            document.getElementById('product-form').reset();
            updateProductDropdowns();
            renderAllCards();
            actualizarCedulaProducto();
        } catch (error) {
            console.error("Error al guardar producto:", error);
        }
    });

    // 5. REGISTRO DE MOVIMIENTOS
    document.getElementById('movement-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const prodId = document.getElementById('mov-product').value;
        if (!prodId) return alert("Selecciona un insumo.");

        const movement = {
            productId: prodId,
            fecha: document.getElementById('mov-date').value,
            ref: document.getElementById('mov-ref').value,
            concepto: document.getElementById('mov-concept').value,
            tipo: document.getElementById('mov-type').value,
            cantidad: parseFloat(document.getElementById('mov-qty').value),
            costoUnitario: parseFloat(document.getElementById('mov-cost').value || 0),
            createdAt: new Date()
        };

        try {
            await window.fs.addDoc(window.fs.collection(window.db, "movimientos"), movement);
            document.getElementById('movement-form').reset();
            await loadMovementsFromFirebase(prodId);
            renderAllCards();
            actualizarCedulaProducto();
        } catch (error) {
            console.error("Error al guardar movimiento:", error);
        }
    });

    // 6. REGISTRO DE PROCESOS
    document.getElementById('process-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (state.isProcesosLocked) {
            return alert("La configuración de procesos está bloqueada por el Área de Administración. Desbloquéala para realizar cambios.");
        }

        const productKey = document.getElementById('proc-product-key').value;
        const name = document.getElementById('proc-name').value.trim();
        const machine = document.getElementById('proc-machine').value.trim();
        const machineCost = parseFloat(document.getElementById('proc-machine-cost').value) || 0;
        const time = parseFloat(document.getElementById('proc-time').value);

        const newProc = { productKey, name, machine, machineCost, time, assignedWorkerId: null, createdAt: new Date() };

        try {
            const docRef = await window.fs.addDoc(window.fs.collection(window.db, "procesos"), newProc);
            state.processes.push({ id: docRef.id, ...newProc });
            document.getElementById('process-form').reset();
            renderProcesosModule();
            actualizarCedulaProducto();
        } catch (error) {
            console.error("Error al guardar proceso:", error);
        }
    });
});

// NAVEGACIÓN
window.switchModule = function(moduleName) {
    ['config', 'mp', 'mo', 'procesos', 'prorrateo', 'reportes', 'presupuesto'].forEach(m => {
        const mod = document.getElementById(`module-${m}`);
        if (mod) mod.classList.add('hidden');
        
        const btn = document.getElementById(`nav-${m}`);
        if (btn) btn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition text-blue-200 hover:text-white";
    });

    const activeMod = document.getElementById(`module-${moduleName}`);
    if (activeMod) activeMod.classList.remove('hidden');

    const activeBtn = document.getElementById(`nav-${moduleName}`);
    if (activeBtn) activeBtn.className = "px-3 py-1.5 text-xs font-bold rounded-lg transition bg-blue-800 text-white";

    if (moduleName === 'procesos') renderProcesosModule();
    if (moduleName === 'prorrateo') calcularYRenderizarProrrateos();
    if (moduleName === 'reportes') actualizarCedulaProducto();
    if (moduleName === 'presupuesto') recalcularPresupuestoUI();
};

window.toggleLockProcesos = function() {
    state.isProcesosLocked = !state.isProcesosLocked;
    renderProcesosModule();
};

function renderProcesosModule() {
    const container = document.getElementById('procesos-list-container');
    const btnLock = document.getElementById('btn-toggle-lock-procesos');
    const procFormInputs = document.querySelectorAll('#process-form input, #process-form select, #process-form button');
    const filterKey = document.getElementById('filter-ruta-product')?.value || 'lente';

    if (btnLock) {
        btnLock.innerText = state.isProcesosLocked ? "🔓 Desbloquear Configuración" : "🔒 Guardar y Bloquear Configuración";
        btnLock.className = state.isProcesosLocked ? 
            "px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg transition" : 
            "px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition";
    }

    procFormInputs.forEach(el => {
        if (state.isProcesosLocked) el.setAttribute('disabled', 'true');
        else el.removeAttribute('disabled');
    });

    if (!container) return;

    const filteredProcs = state.processes.filter(p => (p.productKey || 'lente') === filterKey);

    if (filteredProcs.length === 0) {
        container.innerHTML = `<p class="col-span-2 text-center text-slate-400 p-4 border border-dashed rounded-lg">No hay estaciones o procesos registrados para este producto.</p>`;
        return;
    }

    let htmlOperadoresOpts = '<option value="">-- Sin Operador Asignado --</option>';
    state.workers.forEach(w => {
        const chhProtegido = w.chh || 0;
        htmlOperadoresOpts += `<option value="${w.id}">${w.name} (CHH: $${chhProtegido.toFixed(2)})</option>`;
    });

    let htmlCards = '';
    filteredProcs.forEach((proc, index) => {
        let opts = htmlOperadoresOpts;
        if (proc.assignedWorkerId) {
            opts = opts.replace(`value="${proc.assignedWorkerId}"`, `value="${proc.assignedWorkerId}" selected`);
        }

        const disabledAttr = state.isProcesosLocked ? 'disabled' : '';

        htmlCards += `
            <div class="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 shadow-sm">
                <div class="flex justify-between items-center border-b pb-2">
                    <div>
                        <span class="font-extrabold text-blue-950 text-sm">${index + 1}. ${proc.name}</span>
                        <p class="text-[10px] text-slate-500 font-semibold">Máquina: ${proc.machine} | Importe: $${(proc.machineCost || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
                    </div>
                    <span class="px-2 py-0.5 bg-blue-100 text-blue-900 rounded-md font-extrabold text-xs">${proc.time} hrs</span>
                </div>
                <div>
                    <label class="block text-[11px] font-bold text-slate-600 mb-1">Operador Asignado Permamante:</label>
                    <select ${disabledAttr} onchange="asignarTrabajadorProceso('${proc.id}', this.value)" class="w-full p-2 border rounded-lg text-xs bg-white text-slate-900 font-bold disabled:bg-slate-100 disabled:text-slate-500">
                        ${opts}
                    </select>
                </div>
            </div>`;
    });

    container.innerHTML = htmlCards;
}

window.asignarTrabajadorProceso = async function(processId, workerId) {
    const proc = state.processes.find(p => p.id === processId);
    if (proc) {
        proc.assignedWorkerId = workerId || null;
        try {
            await window.fs.updateDoc(window.fs.doc(window.db, "procesos", processId), { assignedWorkerId: proc.assignedWorkerId });
        } catch (e) {
            console.error("Error al actualizar proceso:", e);
        }
        actualizarCedulaProducto();
    }
};

function calcularYRenderizarProrrateos() {
    const m2 = { Produc: 110, Admon: 40, Ventas: 15, RH: 10, Distr: 40 };
    const totalM2 = 215;

    const rentaTotal = 50000;
    const factorRenta = rentaTotal / totalM2;
    const renta = {}; Object.keys(m2).forEach(k => renta[k] = m2[k] * factorRenta);

    const eeTotal = 22000;
    const eeFM = eeTotal * 0.72; 
    const eeIlum = eeTotal * 0.28; 
    const factorIlum = eeIlum / totalM2;
    const ee = {}; Object.keys(m2).forEach(k => ee[k] = (m2[k] * factorIlum) + (k === 'Produc' ? eeFM : 0));

    const aguaTotal = 2300;
    const factorAgua = aguaTotal / totalM2;
    const agua = {}; Object.keys(m2).forEach(k => agua[k] = m2[k] * factorAgua);

    const gasolina = { Produc: 0, Admon: 0, Ventas: 0, RH: 0, Distr: 2200 };
    const licencias = { Produc: 5000, Admon: 0, Ventas: 0, RH: 0, Distr: 0 };

    const primarioTotales = {};
    Object.keys(m2).forEach(k => {
        primarioTotales[k] = renta[k] + ee[k] + agua[k] + gasolina[k] + licencias[k];
    });

    const tbodyPrimario = document.getElementById('tb-prorrateo-primario');
    if (tbodyPrimario) {
        tbodyPrimario.innerHTML = `
            <tr><td class="p-2 border text-left">Renta de Nave</td><td class="p-2 border">Superficie (${totalM2}m²)</td><td class="p-2 border bg-blue-50 font-bold">$${renta.Produc.toFixed(2)}</td><td class="p-2 border">$${renta.Admon.toFixed(2)}</td><td class="p-2 border">$${renta.Ventas.toFixed(2)}</td><td class="p-2 border">$${renta.RH.toFixed(2)}</td><td class="p-2 border">$${renta.Distr.toFixed(2)}</td><td class="p-2 border font-bold">$${rentaTotal.toFixed(2)}</td></tr>
            <tr><td class="p-2 border text-left">Energía Eléctrica (FM + Ilum)</td><td class="p-2 border">Fuerza Motriz / m²</td><td class="p-2 border bg-blue-50 font-bold">$${ee.Produc.toFixed(2)}</td><td class="p-2 border">$${ee.Admon.toFixed(2)}</td><td class="p-2 border">$${ee.Ventas.toFixed(2)}</td><td class="p-2 border">$${ee.RH.toFixed(2)}</td><td class="p-2 border">$${ee.Distr.toFixed(2)}</td><td class="p-2 border font-bold">$${eeTotal.toFixed(2)}</td></tr>
            <tr><td class="p-2 border text-left">Agua Potable</td><td class="p-2 border">Superficie (${totalM2}m²)</td><td class="p-2 border bg-blue-50 font-bold">$${agua.Produc.toFixed(2)}</td><td class="p-2 border">$${agua.Admon.toFixed(2)}</td><td class="p-2 border">$${agua.Ventas.toFixed(2)}</td><td class="p-2 border">$${agua.RH.toFixed(2)}</td><td class="p-2 border">$${agua.Distr.toFixed(2)}</td><td class="p-2 border font-bold">$${aguaTotal.toFixed(2)}</td></tr>
            <tr><td class="p-2 border text-left">Gasolina Flotilla Reparto</td><td class="p-2 border">Directo a Distribución</td><td class="p-2 border bg-blue-50 font-bold">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$${gasolina.Distr.toFixed(2)}</td><td class="p-2 border font-bold">$${gasolina.Distr.toFixed(2)}</td></tr>
            <tr><td class="p-2 border text-left">Licencias Software Sanitario</td><td class="p-2 border">Directo a Producción</td><td class="p-2 border bg-blue-50 font-bold">$${licencias.Produc.toFixed(2)}</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border">$0.00</td><td class="p-2 border font-bold">$${licencias.Produc.toFixed(2)}</td></tr>
        `;

        document.getElementById('tr-totales-primario').innerHTML = `
            <td colspan="2" class="p-2 border text-right">TOTAL PRORRATEO PRIMARIO:</td>
            <td class="p-2 border text-blue-950 font-extrabold">$${primarioTotales.Produc.toFixed(2)}</td>
            <td class="p-2 border">$${primarioTotales.Admon.toFixed(2)}</td>
            <td class="p-2 border">$${primarioTotales.Ventas.toFixed(2)}</td>
            <td class="p-2 border">$${primarioTotales.RH.toFixed(2)}</td>
            <td class="p-2 border">$${primarioTotales.Distr.toFixed(2)}</td>
            <td class="p-2 border text-blue-950 font-black">$${(50000+22000+2300+2200+5000).toFixed(2)}</td>
        `;
    }

    const rhMonto = primarioTotales.RH;
    const emp = { Produc: 12, Ventas: 3, Distr: 3, Admon: 2 };
    const factorRH = rhMonto / 18;
    const rhDist = { Produc: emp.Produc * factorRH, Ventas: emp.Ventas * factorRH, Distr: emp.Distr * factorRH, Admon: emp.Admon * factorRH };

    const admonMontoAcum = primarioTotales.Admon + rhDist.Admon;
    const admonDist = { Produc: admonMontoAcum * 0.70, Ventas: admonMontoAcum * 0.15, Distr: admonMontoAcum * 0.15 };

    const tbodySecundario = document.getElementById('tb-prorrateo-secundario');
    if (tbodySecundario) {
        tbodySecundario.innerHTML = `
            <tr><td class="p-2 border text-left">Recosteo Recursos Humanos (RH)</td><td class="p-2 border">$${rhMonto.toFixed(2)}</td><td class="p-2 border">Número de Empleados (18 op.)</td><td class="p-2 border bg-blue-50 font-bold">$${rhDist.Produc.toFixed(2)}</td><td class="p-2 border">$${rhDist.Ventas.toFixed(2)}</td><td class="p-2 border">$${rhDist.Distr.toFixed(2)}</td></tr>
            <tr><td class="p-2 border text-left">Recosteo Administración General</td><td class="p-2 border">$${admonMontoAcum.toFixed(2)}</td><td class="p-2 border">Porcentaje Asignación Operativa (70% Fab)</td><td class="p-2 border bg-blue-50 font-bold">$${admonDist.Produc.toFixed(2)}</td><td class="p-2 border">$${admonDist.Ventas.toFixed(2)}</td><td class="p-2 border">$${admonDist.Distr.toFixed(2)}</td></tr>
        `;

        const totalSecProduc = rhDist.Produc + admonDist.Produc;
        document.getElementById('tr-totales-secundario').innerHTML = `
            <td colspan="3" class="p-2 border text-right">TOTAL ASIGNADO A PRODUCCIÓN:</td>
            <td class="p-2 border text-blue-950 font-extrabold">$${totalSecProduc.toFixed(2)}</td>
            <td class="p-2 border">$${(rhDist.Ventas + admonDist.Ventas).toFixed(2)}</td>
            <td class="p-2 border">$${(rhDist.Distr + admonDist.Distr).toFixed(2)}</td>
        `;
    }

    const gifTotalProduccion = primarioTotales.Produc + rhDist.Produc + admonDist.Produc;
    const cuotaPorUnidad = gifTotalProduccion / 1000;
    const cuotaPorHora = gifTotalProduccion / 1450;

    const lblGifA = document.getElementById('lbl-gif-total-a');
    if (lblGifA) lblGifA.innerText = `$${gifTotalProduccion.toFixed(2)}`;
    
    const lblTasaA = document.getElementById('lbl-tasa-gif-unidad');
    if (lblTasaA) lblTasaA.innerText = `$${cuotaPorUnidad.toFixed(2)} / pza`;

    return { gifTotalProduccion, cuotaPorUnidad, cuotaPorHora };
}

window.actualizarCedulaProducto = function() {
    const selectElem = document.getElementById('select-producto-costeo');
    if (!selectElem) return;

    const key = selectElem.value;
    const { cuotaPorUnidad } = calcularYRenderizarProrrateos();

    function getCostoMP(keywords, defaultVal) {
        const prod = state.products.find(p => keywords.some(k => p.name.toLowerCase().includes(k.toLowerCase())));
        if (!prod) return defaultVal;

        const movs = state.movements[prod.id] || [];
        const entradas = movs.filter(m => m.tipo === 'ENTRADA' && m.costoUnitario > 0);
        return entradas.length > 0 ? entradas[entradas.length - 1].costoUnitario : defaultVal;
    }

    const recetasMP = {
        lente: [
            { nombre: "Micas Orgánicas CR-39", tipo: "MPD", cantidadTexto: "1 Par", factor: 1.0, ctoUnit: getCostoMP(["Mica", "CR-39"], 120.00) },
            { nombre: "Armazón de Acetato Inyectado", tipo: "MPD", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Armazón", "Acetato"], 85.00) },
            { nombre: "Estuche y Microfibra", tipo: "MPI", cantidadTexto: "1 Juego", factor: 1.0, ctoUnit: getCostoMP(["Estuche"], 15.00) }
        ],
        armazon: [
            { nombre: "Pellets de Acetato de Celulosa", tipo: "MPD", cantidadTexto: "0.25 Kg", factor: 0.25, ctoUnit: getCostoMP(["Acetato"], 112.00) },
            { nombre: "Alma Metálica y Bisagras", tipo: "MPD", cantidadTexto: "1 Juego", factor: 1.0, ctoUnit: getCostoMP(["Bisagras"], 15.00) },
            { nombre: "Empaque Individual Bolsa", tipo: "MPI", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Bolsa"], 2.00) }
        ],
        kit: [
            { nombre: "Solución Limpiadora 60ml", tipo: "MPD", cantidadTexto: "1 Frasco", factor: 1.0, ctoUnit: getCostoMP(["Solución"], 12.00) },
            { nombre: "Paño Microfibra", tipo: "MPD", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Paño"], 6.00) },
            { nombre: "Estuche Rígido con Cierre", tipo: "MPD", cantidadTexto: "1 Pza", factor: 1.0, ctoUnit: getCostoMP(["Estuche"], 15.00) }
        ]
    };

    const tbodyMP = document.getElementById('tb-cedula-mp');
    let totalMP = 0;
    if (tbodyMP) {
        tbodyMP.innerHTML = '';
        (recetasMP[key] || []).forEach(item => {
            const subtotal = item.ctoUnit * item.factor;
            totalMP += subtotal;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="border border-slate-300 p-2 text-left font-medium">${item.nombre}</td>
                <td class="border border-slate-300 p-2 font-bold ${item.tipo === 'MPD' ? 'text-blue-900' : 'text-amber-700'}">${item.tipo}</td>
                <td class="border border-slate-300 p-2">${item.cantidadTexto}</td>
                <td class="border border-slate-300 p-2">$${item.ctoUnit.toFixed(2)}</td>
                <td class="border border-slate-300 p-2 font-bold">$${subtotal.toFixed(2)}</td>`;
            tbodyMP.appendChild(tr);
        });

        document.getElementById('lbl-cedula-total-mp').innerText = `$${totalMP.toFixed(2)}`;
    }

    const tbodyMO = document.getElementById('tb-cedula-mo');
    let totalMO = 0;
    let tiempoTotalHoras = 0;

    const rutaProcesos = state.processes.filter(p => (p.productKey || 'lente') === key);

    if (tbodyMO) {
        tbodyMO.innerHTML = '';
        if (rutaProcesos.length === 0) {
            tbodyMO.innerHTML = `<tr><td colspan="5" class="p-3 text-slate-400">No hay procesos configurados para la ruta de este producto.</td></tr>`;
        } else {
            rutaProcesos.forEach(proc => {
                const worker = state.workers.find(w => w.id === proc.assignedWorkerId);
                const workerName = worker ? worker.name : 'Sin Asignar (CHH Base)';
                const chhVal = worker ? worker.chh : 35.82;
                const subtotal = proc.time * chhVal;

                totalMO += subtotal;
                tiempoTotalHoras += proc.time;

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="border border-slate-300 p-2 text-left font-bold text-blue-950">${proc.name} (${proc.machine})</td>
                    <td class="border border-slate-300 p-2 text-left">${workerName}</td>
                    <td class="border border-slate-300 p-2">${proc.time} hrs</td>
                    <td class="border border-slate-300 p-2">$${chhVal.toFixed(2)}</td>
                    <td class="border border-slate-300 p-2 font-bold">$${subtotal.toFixed(2)}</td>`;
                tbodyMO.appendChild(tr);
            });
        }

        document.getElementById('lbl-cedula-total-mo').innerText = `$${totalMO.toFixed(2)}`;
    }

    const totalGIF = cuotaPorUnidad * 1; 
    
    const lblGifTasa = document.getElementById('lbl-cedula-gif-tasa');
    if (lblGifTasa) lblGifTasa.innerText = `$${cuotaPorUnidad.toFixed(2)} / pza`;
    
    const lblGifTiempo = document.getElementById('lbl-cedula-gif-tiempo');
    if (lblGifTiempo) lblGifTiempo.innerText = `1 Unidad (Opción A)`;
    
    const lblTotalGif = document.getElementById('lbl-cedula-total-gif');
    if (lblTotalGif) lblTotalGif.innerText = `$${totalGIF.toFixed(2)}`;

    const costoPrimo = totalMP + totalMO;
    const costoTransformacion = totalMO + totalGIF;
    const costoFinal = totalMP + totalMO + totalGIF;

    document.getElementById('lbl-costo-primo').innerText = `$${costoPrimo.toFixed(2)} MXN`;
    document.getElementById('lbl-costo-transformacion').innerText = `$${costoTransformacion.toFixed(2)} MXN`;
    document.getElementById('lbl-cedula-costo-final').innerText = `$${costoFinal.toFixed(2)} MXN`;

    const qrContainer = document.getElementById('qrcode-container');
    if (qrContainer && window.QRCode) {
        qrContainer.innerHTML = '';
        const qrData = `OptiCost | Prod: ${key.toUpperCase()} | Tot: $${costoFinal.toFixed(2)} | F: ${new Date().toLocaleDateString()}`;
        
        try {
            new QRCode(qrContainer, {
                text: qrData,
                width: 96,
                height: 96,
                colorDark : "#0f172a",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.L
            });
        } catch (e) {
            console.warn("No se pudo generar el QR", e);
        }
    }
};

async function renderAllCards() {
    const container = document.getElementById('cards-container');
    if (!container) return;

    if (state.products.length === 0) {
        container.innerHTML = `<div class="p-6 text-center border border-dashed border-slate-300 rounded-lg bg-slate-50"><p class="text-sm text-slate-500">No hay insumos ni tarjetas registradas.</p></div>`;
        return;
    }

    container.innerHTML = '';

    for (const product of state.products) {
        if (!state.movements[product.id]) {
            await loadMovementsFromFirebase(product.id);
        }

        const productWithGlobalMethod = { ...product, metodo: state.globalMethod };
        const rawMovements = state.movements[product.id] || [];
        const { rows, totalDebe, totalHaber, saldoFinal } = InventoryEngine.processMovements(productWithGlobalMethod, rawMovements);

        const cardWrapper = document.createElement('div');
        cardWrapper.className = "border border-slate-300 rounded-xl overflow-hidden shadow-sm bg-white mb-6 report-card";

        let rowsHTML = '';
        rows.forEach(r => {
            rowsHTML += `
                <tr class="${r.isSubRow ? 'row-sub border-b border-slate-200' : 'row-main border-b border-slate-300'}">
                    <td class="border border-slate-300 p-2">${r.fecha}</td>
                    <td class="border border-slate-300 p-2">${r.ref}</td>
                    <td class="border border-slate-300 p-2 text-left">${r.concepto}</td>
                    <td class="border border-slate-300 p-2 font-semibold">${r.entradas}</td>
                    <td class="border border-slate-300 p-2 text-red-700 font-semibold">${r.salidas}</td>
                    <td class="border border-slate-300 p-2 font-bold">${r.existencia} ${product.unit}</td>
                    <td class="border border-slate-300 p-2">${r.costoUnitario ? '$' + r.costoUnitario : ''}</td>
                    <td class="border border-slate-300 p-2">${r.debe ? '$' + r.debe : ''}</td>
                    <td class="border border-slate-300 p-2">${r.haber ? '$' + r.haber : ''}</td>
                    <td class="border border-slate-300 p-2 font-bold text-blue-950">$${r.saldo}</td>
                </tr>`;
        });

        cardWrapper.innerHTML = `
            <div class="bg-slate-100 px-4 py-3 border-b border-slate-300 flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-base text-blue-950">${product.name}</h3>
                    <p class="text-xs text-slate-500">Unidad: <span class="font-semibold text-slate-700">${product.unit}</span></p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-1 bg-blue-950 text-white font-bold text-xs rounded-lg">${state.globalMethod}</span>
                    <button onclick="printSpecificReport(this, 'Tarjeta de Almacén - ${product.name}')" class="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-2 py-1 rounded-lg transition font-bold">Imprimir</button>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full border-collapse border border-slate-300 text-xs text-center">
                    <thead class="bg-blue-950 text-white font-bold">
                        <tr>
                            <th class="border border-slate-300 p-2">Fecha</th>
                            <th class="border border-slate-300 p-2">Ref</th>
                            <th class="border border-slate-300 p-2">Concepto</th>
                            <th class="border border-slate-300 p-2">Entradas</th>
                            <th class="border border-slate-300 p-2">Salidas</th>
                            <th class="border border-slate-300 p-2">Existencia</th>
                            <th class="border border-slate-300 p-2">Cto Ut</th>
                            <th class="border border-slate-300 p-2">Debe</th>
                            <th class="border border-slate-300 p-2">Haber</th>
                            <th class="border border-slate-300 p-2">Saldo</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200">${rowsHTML || '<tr><td colspan="10" class="p-3 text-slate-400">Sin movimientos registrados</td></tr>'}</tbody>
                    <tfoot class="bg-slate-100 font-bold border-t-2 border-slate-400">
                        <tr>
                            <td colspan="7" class="border border-slate-300 p-2 text-right">TOTALES / SALDO FINAL:</td>
                            <td class="border border-slate-300 p-2 text-blue-950">$${totalDebe.toFixed(2)}</td>
                            <td class="border border-slate-300 p-2 text-blue-950">$${totalHaber.toFixed(2)}</td>
                            <td class="border border-slate-300 p-2 text-blue-950 font-black">$${saldoFinal.toFixed(2)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;

        container.appendChild(cardWrapper);
    }
}

async function loadProductsFromFirebase() {
    try {
        const querySnapshot = await window.fs.getDocs(window.fs.collection(window.db, "productos"));
        state.products = [];
        querySnapshot.forEach((doc) => {
            state.products.push({ id: doc.id, ...doc.data() });
        });

        updateProductDropdowns();

        for (const p of state.products) {
            await loadMovementsFromFirebase(p.id);
        }

        renderAllCards();
        actualizarCedulaProducto();
    } catch (error) {
        console.error("Error al cargar productos:", error);
    }
}

async function loadWorkersFromFirebase() {
    try {
        const querySnapshot = await window.fs.getDocs(window.fs.collection(window.db, "trabajadores"));
        state.workers = [];
        
        querySnapshot.forEach((doc) => {
            state.workers.push({ id: doc.id, ...doc.data() });
        });

        state.workers.sort((a, b) => {
            const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
            const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
            return dateA - dateB;
        });

        const container = document.getElementById('workers-reports-container');
        if (container) {
            container.innerHTML = '';
            
            const groups = {};
            state.workers.forEach(w => {
                const key = w.session || "Reporte Histórico Anterior";
                if (!groups[key]) groups[key] = [];
                groups[key].push(w);
            });

            Object.keys(groups).forEach((sessionKey) => {
                const workersInGroup = groups[sessionKey];
                
                let tbodyHTML = '';
                workersInGroup.forEach(w => {
                    const pBase = w.percepcionBase || w.dailyWage || 0;
                    const dWage = w.dailyWage || 0;
                    
                    tbodyHTML += `
                        <tr class="border-b border-slate-300 whitespace-nowrap">
                            <td class="p-2 border font-bold text-left">${w.name || 'Sin nombre'}</td>
                            <td class="p-2 border text-slate-600">${w.startDate || 'N/A'}</td>
                            <td class="p-2 border bg-blue-50 font-bold">${w.tipoContrato || 'Diario'}</td>
                            <td class="p-2 border bg-slate-50 font-semibold">$${pBase.toFixed(2)}</td>
                            <td class="p-2 border bg-slate-50">${w.tipoJornada || 'Diurna'} (${w.jornada || 8}h)</td>
                            <td class="p-2 border bg-slate-50 font-semibold">${w.diasVacaciones !== undefined ? w.diasVacaciones : 12}</td>
                            <td class="p-2 border bg-slate-50 text-red-600 font-semibold">${w.faltas || 0}</td>
                            <td class="p-2 border bg-slate-50 text-slate-500">${w.diasLibresLey || 59}</td>
                            <td class="p-2 border bg-blue-50 font-black text-blue-900">${w.diasLab !== undefined ? w.diasLab : 302}</td>
                            <td class="p-2 border font-bold text-indigo-900">$${dWage.toFixed(2)}</td>
                            <td class="p-2 border">$${(w.sueldoAnual || 0).toFixed(2)}</td>
                            <td class="p-2 border">$${(w.subtotalLey || 0).toFixed(2)}</td>
                            <td class="p-2 border">$${(w.cargasPatronales || 0).toFixed(2)}</td>
                            <td class="p-2 border text-slate-500 font-semibold">$${(w.salarioIntegradoAnual || 0).toFixed(2)}</td>
                            <td class="p-2 border bg-slate-100 font-bold">$${(w.salarioIntegradoDiario || 0).toFixed(2)}</td>
                            <td class="p-2 border bg-emerald-100 text-emerald-900 font-extrabold">$${(w.chh || 0).toFixed(2)}</td>
                        </tr>`;
                });

                const isCurrentSession = (sessionKey === state.sessionId);
                const headerClass = isCurrentSession ? 'bg-blue-950' : 'bg-slate-700';
                const titleBadge = isCurrentSession 
                    ? '<span class="ml-3 px-2 py-0.5 bg-emerald-500 text-white text-[10px] rounded uppercase font-bold tracking-wide shadow-sm">Sesión Actual</span>' 
                    : '';

                const tableHTML = `
                    <div class="border border-slate-300 rounded-xl overflow-hidden shadow-sm mb-8 report-card">
                        <div class="bg-slate-100 px-4 py-3 border-b border-slate-300 flex justify-between items-center">
                            <h3 class="font-bold text-slate-800 text-sm">📋 Grupo de Alta: <span class="font-medium text-slate-600">${sessionKey}</span> ${titleBadge}</h3>
                            <button onclick="printSpecificReport(this, 'Reporte de Nómina LFT')" class="text-xs bg-white border border-slate-300 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition font-bold shadow-sm">
                                🖨️ Imprimir Reporte
                            </button>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full border-collapse border border-slate-300 text-xs text-center">
                                <thead class="${headerClass} text-white font-bold">
                                    <tr>
                                        <th class="border border-slate-300 p-2 text-left">Puesto / Trabajador</th>
                                        <th class="border border-slate-300 p-2">Ingreso</th>
                                        <th class="border border-slate-300 p-2">Contrato</th>
                                        <th class="border border-slate-300 p-2">Percepción</th>
                                        <th class="border border-slate-300 p-2">Jornada</th>
                                        <th class="border border-slate-300 p-2">Vac.</th>
                                        <th class="border border-slate-300 p-2">Faltas</th>
                                        <th class="border border-slate-300 p-2">Libres (Ley)</th>
                                        <th class="border border-slate-300 p-2 bg-blue-800/50">Días Lab.</th>
                                        <th class="border border-slate-300 p-2">SD Real</th>
                                        <th class="border border-slate-300 p-2">Sueldo Anual</th>
                                        <th class="border border-slate-300 p-2">Sub. Ley</th>
                                        <th class="border border-slate-300 p-2">Cargas Pat.</th>
                                        <th class="border border-slate-300 p-2">Sal. Int. Anual</th>
                                        <th class="border border-slate-300 p-2 bg-slate-900/20">Sal. Int. Diario</th>
                                        <th class="border border-slate-300 p-2 bg-emerald-700 text-white">CHH ($)</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-200">${tbodyHTML}</tbody>
                            </table>
                        </div>
                    </div>
                `;
                container.innerHTML += tableHTML;
            });
        }

        renderProcesosModule();
        actualizarCedulaProducto();
    } catch (error) {
        console.error("Error al cargar trabajadores:", error);
    }
}

async function loadProcessesFromFirebase() {
    try {
        const querySnapshot = await window.fs.getDocs(window.fs.collection(window.db, "procesos"));
        state.processes = [];
        querySnapshot.forEach((doc) => {
            state.processes.push({ id: doc.id, ...doc.data() });
        });

        renderProcesosModule();
        actualizarCedulaProducto();
    } catch (error) {
        console.error("Error al cargar procesos:", error);
    }
}

async function loadMovementsFromFirebase(productId) {
    try {
        const q = window.fs.query(
            window.fs.collection(window.db, "movimientos"), 
            window.fs.where("productId", "==", productId)
        );
        const querySnapshot = await window.fs.getDocs(q);
        
        state.movements[productId] = [];
        querySnapshot.forEach((doc) => {
            state.movements[productId].push(doc.data());
        });

        state.movements[productId].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    } catch (error) {
        console.error("Error al cargar movimientos:", error);
    }
}

function updateProductDropdowns() {
    const movProductSelect = document.getElementById('mov-product');
    if (!movProductSelect) return;

    movProductSelect.innerHTML = '';
    state.products.forEach(p => {
        movProductSelect.add(new Option(`${p.name}`, p.id));
    });
}

function calcularDiasVacaciones(fechaIngreso) {
    const hoy = new Date();
    const ingreso = new Date(fechaIngreso);
    let antiguedad = hoy.getFullYear() - ingreso.getFullYear();
    
    const mes = hoy.getMonth() - ingreso.getMonth();
    if (mes < 0 || (mes === 0 && hoy.getDate() < ingreso.getDate())) {
        antiguedad--;
    }

    if (antiguedad < 1) return 0;
    if (antiguedad === 1) return 12;
    if (antiguedad === 2) return 14;
    if (antiguedad === 3) return 16;
    if (antiguedad === 4) return 18;
    if (antiguedad === 5) return 20;
    return 22 + Math.floor((antiguedad - 6) / 5) * 2;
}

function calculateWorkerCHH(dailyWage, fechaIngreso, tipoJornada, faltas) {
    let jornada = 8;
    if (tipoJornada === 'Nocturna') jornada = 7;
    if (tipoJornada === 'Mixta') jornada = 7.5;

    const diasVacaciones = calcularDiasVacaciones(fechaIngreso);
    const diasAnuales = 365;
    const domingos = 52;
    const diasFestivos = 7; 
    const diasLibresLey = domingos + diasFestivos; 
    
    const diasLab = diasAnuales - diasLibresLey - diasVacaciones - faltas;
    
    const sueldoAnual = dailyWage * 365;
    const aguinaldo = dailyWage * 15;
    const primaVacacional = (dailyWage * diasVacaciones) * 0.25; 
    const subtotalLey = sueldoAnual + aguinaldo + primaVacacional;

    const comedorAnual = 48 * 19.83 * 12;
    const valesAnual = 1200 * 12;
    const eqSeguridad = 1720;

    const cargasPatronales = subtotalLey * 0.14;
    const salarioIntegradoAnual = subtotalLey + comedorAnual + valesAnual + cargasPatronales + eqSeguridad;

    const salarioIntegradoDiario = salarioIntegradoAnual / diasLab;
    const chh = salarioIntegradoDiario / jornada;

    return { 
        sueldoAnual, subtotalLey, cargasPatronales, salarioIntegradoAnual, 
        salarioIntegradoDiario, chh, diasLab, diasVacaciones, tipoJornada, faltas, jornada, diasLibresLey 
    };
}

document.getElementById('worker-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('wrk-name').value;
    const startDate = document.getElementById('wrk-date').value;
    
    const tipoContrato = document.getElementById('wrk-contrato').value;
    const percepcionBase = parseFloat(document.getElementById('wrk-wage').value);
    const tipoJornada = document.getElementById('wrk-jornada').value;
    const faltas = parseInt(document.getElementById('wrk-faltas').value) || 0;

    let dailyWage = percepcionBase;
    if (tipoContrato === 'Semanal') dailyWage = percepcionBase / 7;
    if (tipoContrato === 'Mensual') dailyWage = percepcionBase / 30;

    const calc = calculateWorkerCHH(dailyWage, startDate, tipoJornada, faltas);
    const newWorker = { 
        name, 
        startDate, 
        tipoContrato, 
        percepcionBase, 
        dailyWage, 
        ...calc, 
        createdAt: new Date(), 
        session: state.sessionId 
    };

    try {
        await window.fs.addDoc(window.fs.collection(window.db, "trabajadores"), newWorker);
        document.getElementById('worker-form').reset();
        await loadWorkersFromFirebase();
    } catch (error) {
        console.error("Error al guardar trabajador:", error);
    }
});

// =========================================================================
// CONTROLADOR UI: MÓDULO DE PRESUPUESTO DE VENTAS
// =========================================================================
function formatMXN(valor) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(valor || 0);
}

window.cargarMesPresupuesto = function() {
    const mesSelect = document.getElementById('pres-mes');
    if (!mesSelect || typeof PRESUPUESTO_EXCEL_DATA === 'undefined') return;

    const mes = mesSelect.value;
    const datos = PRESUPUESTO_EXCEL_DATA[mes];
    if (!datos) return;

    document.getElementById('pres-gif').value = datos.gif;
    document.getElementById('pres-mo').value = datos.mo;
    document.getElementById('pres-admon').value = datos.admon;
    document.getElementById('pres-venta').value = datos.venta;
    document.getElementById('pres-distrib').value = datos.distrib;

    recalcularPresupuestoUI();
};

window.resetFactoresPresupuesto = function() {
    document.getElementById('pres-f-ajuste').value = 0;
    document.getElementById('pres-f-cambio').value = 0;
    document.getElementById('pres-f-crec').value = 0;
    document.getElementById('pres-e-inf').value = 0;
    document.getElementById('pres-e-dolar').value = 0;
    document.getElementById('pres-e-otros').value = 0;
    document.getElementById('pres-d-admin').value = 0;
    recalcularPresupuestoUI();
};

window.recalcularPresupuestoUI = function() {
    const mesSelect = document.getElementById('pres-mes');
    if (!mesSelect || typeof BudgetEngine === 'undefined') return;

    const mes = mesSelect.value;
    const res = BudgetEngine.calculate({
        gif: document.getElementById('pres-gif')?.value,
        mo: document.getElementById('pres-mo')?.value,
        admon: document.getElementById('pres-admon')?.value,
        venta: document.getElementById('pres-venta')?.value,
        distrib: document.getElementById('pres-distrib')?.value,
        multiplicadorVentas: document.getElementById('pres-mult')?.value,
        tasaISR: document.getElementById('pres-isr')?.value,
        incluirPTU: document.getElementById('pres-ptu')?.checked,
        fAjuste: document.getElementById('pres-f-ajuste')?.value,
        fCambio: document.getElementById('pres-f-cambio')?.value,
        fCrecimiento: document.getElementById('pres-f-crec')?.value,
        eInflacion: document.getElementById('pres-e-inf')?.value,
        eDolar: document.getElementById('pres-e-dolar')?.value,
        eOtros: document.getElementById('pres-e-otros')?.value,
        dAdminPct: document.getElementById('pres-d-admin')?.value
    });

    const h = res.historia;
    const f = res.formula;

    const tituloMes = document.getElementById('pres-titulo-mes');
    if (tituloMes) tituloMes.innerText = mes;

    const kpiPV = document.getElementById('pres-kpi-pv');
    if (kpiPV) kpiPV.innerText = `${formatMXN(f.pv)} MXN`;

    const kpiV = document.getElementById('pres-kpi-v');
    if (kpiV) kpiV.innerText = `${formatMXN(h.ventasHistoricas)} MXN`;

    const kpiUneta = document.getElementById('pres-kpi-uneta');
    if (kpiUneta) kpiUneta.innerText = `${formatMXN(h.utilidadNeta)} MXN`;

    const tbodyEdo = document.getElementById('tb-pres-edo');
    if (tbodyEdo) {
        const labelImp = h.tasaPTU > 0 ? `ISR (${h.tasaISR}%) + PTU (${h.tasaPTU}%)` : `ISR (${h.tasaISR}%)`;
        tbodyEdo.innerHTML = `
            <tr class="bg-blue-50/70 font-extrabold text-blue-950">
                <td class="border border-slate-300 p-2 text-left">Ventas Históricas del Mes (V)</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.ventasHistoricas)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Gastos de Producción reclasificados a Costos (GIF)</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.gif)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Mano de Obra (Sueldos + Salarios)</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.mo)}</td>
            </tr>
            <tr class="font-bold text-slate-800 bg-slate-50">
                <td class="border border-slate-300 p-2 text-left">(-) Total Costos de Producción</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.totalCostos)}</td>
            </tr>
            <tr class="font-extrabold text-blue-950 bg-slate-100">
                <td class="border border-slate-300 p-2 text-left">(=) Utilidad Bruta</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.utilidadBruta)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Gastos de Administración</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.admon)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Gastos de Venta</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.venta)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left pl-4 text-slate-600">• Gastos de Distribución</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-slate-600">${formatMXN(h.distrib)}</td>
            </tr>
            <tr class="font-bold text-slate-800 bg-slate-50">
                <td class="border border-slate-300 p-2 text-left">(-) Total Gastos de Operación</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.totalGastosOp)}</td>
            </tr>
            <tr class="font-extrabold text-indigo-950 bg-slate-100">
                <td class="border border-slate-300 p-2 text-left">(=) Utilidad Antes de Impuestos (UAI)</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.uai)}</td>
            </tr>
            <tr>
                <td class="border border-slate-300 p-2 text-left text-slate-600">(-) ${labelImp}</td>
                <td class="border border-slate-300 p-2 text-right font-mono text-red-700">${formatMXN(h.isr + h.ptu)}</td>
            </tr>
            <tr class="font-black text-emerald-900 bg-emerald-100">
                <td class="border border-slate-300 p-2 text-left">(=) UTILIDAD NETA HISTÓRICA</td>
                <td class="border border-slate-300 p-2 text-right font-mono">${formatMXN(h.utilidadNeta)}</td>
            </tr>
        `;
    }

    const pasosContainer = document.getElementById('pres-pasos-formula');
    if (pasosContainer) {
        const signoF = f.fNeto >= 0 ? '+' : '-';
        const signoE = f.ePctTotal >= 0 ? '+' : '';
        const signoD = f.dAdminPct >= 0 ? '+' : '';

        pasosContainer.innerHTML = `
            <div class="p-3 rounded-lg bg-slate-50 border border-slate-300">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-extrabold text-blue-950 text-xs">Paso 1: Ajuste por Factores Específicos (V ± F)</span>
                    <span class="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10px] font-bold">F neto: ${formatMXN(f.fNeto)}</span>
                </div>
                <p class="text-[11px] text-slate-500 mb-1">Ajuste (${formatMXN(f.fAjuste)}) + Cambio (${formatMXN(f.fCambio)}) + Crecimiento (${formatMXN(f.fCrecimiento)})</p>
                <p class="font-mono text-xs text-slate-800">${formatMXN(f.V)} ${signoF} ${formatMXN(Math.abs(f.fNeto))} = <strong class="text-blue-950">${formatMXN(f.baseVF)}</strong></p>
            </div>

            <div class="p-3 rounded-lg bg-amber-50 border border-amber-300">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-extrabold text-amber-950 text-xs">Paso 2: Fuerzas Económicas Generales (× E)</span>
                    <span class="px-2 py-0.5 rounded bg-amber-200 text-amber-950 text-[10px] font-bold">E = ${f.factorE.toFixed(4)} (${signoE}${f.ePctTotal.toFixed(2)}%)</span>
                </div>
                <p class="text-[11px] text-amber-900 mb-1">Inflación (${f.eInflacion}%) + Dólar/T.C. (${f.eDolar}%) + PIB/Otros (${f.eOtros}%)</p>
                <p class="font-mono text-xs text-slate-800">${formatMXN(f.baseVF)} × ${f.factorE.toFixed(4)} = <strong class="text-amber-950">${formatMXN(f.baseVFE)}</strong></p>
            </div>

            <div class="p-3 rounded-lg bg-emerald-50 border border-emerald-300">
                <div class="flex justify-between items-center mb-1">
                    <span class="font-extrabold text-emerald-950 text-xs">Paso 3: Influencia Administrativa (× D)</span>
                    <span class="px-2 py-0.5 rounded bg-emerald-200 text-emerald-950 text-[10px] font-bold">D = ${f.factorD.toFixed(4)} (${signoD}${f.dAdminPct.toFixed(2)}%)</span>
                </div>
                <p class="text-[11px] text-emerald-900 mb-1">Decisiones internas de dirección (publicidad, crédito, rutas, capacidad)</p>
                <p class="font-mono text-xs text-slate-800">${formatMXN(f.baseVFE)} × ${f.factorD.toFixed(4)} = <strong class="text-emerald-900 text-sm">${formatMXN(f.pv)}</strong></p>
            </div>

            <div class="p-4 rounded-xl bg-blue-950 text-white flex justify-between items-center shadow">
                <div>
                    <span class="text-[10px] uppercase tracking-wider text-blue-300 font-bold block">Resultado Final Presupuesto de Ventas (${mes})</span>
                    <span class="text-xs font-mono text-blue-200">PV = [(V ± F) × E] × D</span>
                </div>
                <span class="text-xl font-black text-emerald-400 font-mono">${formatMXN(f.pv)}</span>
            </div>
        `;
    }
};

// IMPRESIÓN INDIVIDUAL AJUSTADA (Modo Horizontal Automático y Celdas Adaptables)
window.printSpecificReport = function(btn, tituloReporte = "Documento") {
    const reportCard = btn.closest('.report-card');
    const clone = reportCard.cloneNode(true);
    const btns = clone.querySelectorAll('button');
    btns.forEach(b => b.remove());

    const printWindow = window.open('', '_blank');
    if(!printWindow) {
        alert("Tu navegador bloqueó la ventana de impresión. Por favor, permite las ventanas emergentes (pop-ups) para imprimir.");
        return;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <title>${tituloReporte}</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
                /* Orientación horizontal por defecto */
                @page { size: landscape; margin: 15mm; }
                body { padding: 20px; font-family: sans-serif; }
                * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                
                /* Eliminar el scroll y obligar a que todo el contenido se expanda al ancho de la hoja */
                .overflow-x-auto { overflow: visible !important; width: 100% !important; }
                
                /* Reducir tamaño de texto y permitir salto de línea para que las 16 columnas quepan */
                table { width: 100% !important; table-layout: auto !important; }
                th, td { 
                    font-size: 8.5px !important; 
                    padding: 4px !important; 
                    white-space: normal !important; 
                    word-wrap: break-word !important; 
                }
                .whitespace-nowrap { white-space: normal !important; }
                
                table { page-break-inside: auto; }
                tr { page-break-inside: avoid; page-break-after: auto; }
            </style>
        </head>
        <body>
            <div class="mb-4 border-b-2 border-slate-300 pb-2">
                <h2 class="text-2xl font-black text-blue-950">OptiCost ERP</h2>
                <p class="text-xs text-slate-600 font-bold">${tituloReporte} | Emitido: ${new Date().toLocaleDateString('es-MX')} a las ${new Date().toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}</p>
            </div>
            
            ${clone.outerHTML}

            <script>
                setTimeout(() => {
                    window.print();
                    window.close();
                }, 1000);
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
};
