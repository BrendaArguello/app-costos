class InventoryEngine {

    static processMovements(product, rawMovements) {
        let existencias = 0;
        let saldo = 0;
        let capas = []; 

        const renderedRows = [];
        let totalDebe = 0;
        let totalHaber = 0;

        for (const mov of rawMovements) {
            if (mov.tipo === 'ENTRADA') {
                existencias += mov.cantidad;
                const debeRow = Number((mov.cantidad * mov.costoUnitario).toFixed(2));
                saldo += debeRow;
                totalDebe += debeRow;

                capas.push({ cantidad: mov.cantidad, costo: mov.costoUnitario });

                renderedRows.push({
                    isSubRow: false,
                    fecha: mov.fecha,
                    ref: mov.ref,
                    concepto: mov.concepto,
                    entradas: mov.cantidad,
                    salidas: '',
                    existencia: existencias,
                    costoUnitario: mov.costoUnitario.toFixed(2),
                    debe: debeRow.toFixed(2),
                    haber: '',
                    saldo: saldo.toFixed(2)
                });

            } else if (mov.tipo === 'SALIDA') {
                if (mov.cantidad > existencias) {
                    alert(`Operación denegada: Stock insuficiente (${existencias} ${product.unit} disponibles).`);
                    continue;
                }

                if (product.metodo === 'PROMEDIO') {
                    const costoPromedio = Number((saldo / existencias).toFixed(2));
                    existencias -= mov.cantidad;
                    const haberRow = Number((mov.cantidad * costoPromedio).toFixed(2));
                    saldo = Number((saldo - haberRow).toFixed(2));
                    totalHaber += haberRow;

                    renderedRows.push({
                        isSubRow: false,
                        fecha: mov.fecha,
                        ref: mov.ref,
                        concepto: mov.concepto,
                        entradas: '',
                        salidas: mov.cantidad,
                        existencia: existencias,
                        costoUnitario: costoPromedio.toFixed(2),
                        debe: '',
                        haber: haberRow.toFixed(2),
                        saldo: saldo.toFixed(2)
                    });

                } else if (product.metodo === 'PEPS' || product.metodo === 'UEPS') {
                    let cantidadPendiente = mov.cantidad;
                    let esPrimerRenglon = true;

                    // Procesar capa por capa hasta cubrir la cantidad de la salida
                    while (cantidadPendiente > 0 && capas.length > 0) {
                        const index = product.metodo === 'PEPS' ? 0 : capas.length - 1;
                        const capaActual = capas[index];

                        // Determinar cuántas unidades se toman de la capa actual
                        const unidadesAgotadas = Math.min(capaActual.cantidad, cantidadPendiente);
                        
                        // Actualizar stock de la capa y pendiente global
                        capaActual.cantidad -= unidadesAgotadas;
                        cantidadPendiente -= unidadesAgotadas;
                        existencias -= unidadesAgotadas;

                        // Cálculos monetarios del tramo
                        const haberSub = Number((unidadesAgotadas * capaActual.costo).toFixed(2));
                        saldo = Number((saldo - haberSub).toFixed(2));
                        totalHaber += haberSub;

                        // Generar la fila (la primera mantiene los datos del documento; las subfilas indican el costo del lote)
                        renderedRows.push({
                            isSubRow: !esPrimerRenglon,
                            fecha: esPrimerRenglon ? mov.fecha : '',
                            ref: esPrimerRenglon ? mov.ref : '',
                            concepto: esPrimerRenglon ? mov.concepto : `(Restante a Lote $${capaActual.costo.toFixed(2)})`,
                            entradas: '',
                            salidas: unidadesAgotadas,
                            existencia: existencias,
                            costoUnitario: capaActual.costo.toFixed(2),
                            debe: '',
                            haber: haberSub.toFixed(2),
                            saldo: saldo.toFixed(2)
                        });

                        esPrimerRenglon = false;

                        // Si la capa quedó en 0, se elimina del arreglo para pasar a la siguiente
                        if (capaActual.cantidad === 0) {
                            capas.splice(index, 1);
                        }
                    }
                }
            }

            saldo = Number(saldo.toFixed(2));
        }

        return { rows: renderedRows, totalDebe, totalHaber, saldoFinal: saldo };
    }
}

// =========================================================================
// MOTOR DE PRESUPUESTO DE VENTAS (RECLASIFICACIÓN HISTÓRICA + FÓRMULA PV)
// =========================================================================
const PRESUPUESTO_EXCEL_DATA = {
    ENERO:      { gif: 98449.00,   mo: 159301.93, admon: 44041.93,    venta: 11804.00,    distrib: 49255.25 },
    FEBRERO:    { gif: 98449.00,   mo: 159301.93, admon: 44041.93,    venta: 11804.00,    distrib: 49255.25 },
    MARZO:      { gif: 98449.00,   mo: 159301.93, admon: 44041.93,    venta: 11804.00,    distrib: 49255.25 },
    ABRIL:      { gif: 99708.97,   mo: 159301.93, admon: 54223.70575, venta: 32542.16703, distrib: 52055.77 },
    MAYO:       { gif: 95199.18,   mo: 159301.93, admon: 48512.45575, venta: 35755.204,   distrib: 48104.45 },
    JUNIO:      { gif: 90386.26,   mo: 159301.93, admon: 51500.37775, venta: 30686.4577,  distrib: 49625.709 },
    JULIO:      { gif: 118029.58,  mo: 159301.93, admon: 50092.8135,  venta: 25471.5807,  distrib: 46301.41 },
    AGOSTO:     { gif: 89075.64,   mo: 159301.93, admon: 54750.18,    venta: 34597.823,   distrib: 45090.2378 },
    SEPTIEMBRE: { gif: 119997.006, mo: 159301.93, admon: 61102.6921,  venta: 33135.0574,  distrib: 44949.0928 },
    OCTUBRE:    { gif: 119997.006, mo: 159301.93, admon: 61102.6921,  venta: 33135.0574,  distrib: 44949.0928 },
    NOVIEMBRE:  { gif: 119997.006, mo: 159301.93, admon: 61102.6921,  venta: 33135.0574,  distrib: 44949.0928 },
    DICIEMBRE:  { gif: 119997.006, mo: 159301.93, admon: 61102.6921,  venta: 33135.0574,  distrib: 44949.0928 }
};

class BudgetEngine {

    static calculate(params) {
        const gif = Number(params.gif) || 0;
        const mo = Number(params.mo) || 0;
        const admon = Number(params.admon) || 0;
        const venta = Number(params.venta) || 0;
        const distrib = Number(params.distrib) || 0;
        const multiplicadorVentas = Number(params.multiplicadorVentas) || 3;
        const tasaISR = Number(params.tasaISR) || 30;
        const incluirPTU = Boolean(params.incluirPTU);
        const tasaPTU = incluirPTU ? 10 : 0;

        // 1. Reclasificación contable y Estado de Resultados Histórico
        const totalCostos = gif + mo;
        const ventasHistoricas = totalCostos * multiplicadorVentas; // V
        const utilidadBruta = ventasHistoricas - totalCostos;
        const totalGastosOp = admon + venta + distrib;
        const uai = utilidadBruta - totalGastosOp;
        const isr = uai > 0 ? uai * (tasaISR / 100) : 0;
        const ptu = uai > 0 ? uai * (tasaPTU / 100) : 0;
        const utilidadNeta = uai - isr - ptu;

        // 2. Fórmula de Presupuesto de Ventas: PV = [(V ± F) × E] × D
        const fAjuste = Number(params.fAjuste) || 0;
        const fCambio = Number(params.fCambio) || 0;
        const fCrecimiento = Number(params.fCrecimiento) || 0;
        const fNeto = fAjuste + fCambio + fCrecimiento;
        const baseVF = ventasHistoricas + fNeto;

        const eInflacion = Number(params.eInflacion) || 0;
        const eDolar = Number(params.eDolar) || 0;
        const eOtros = Number(params.eOtros) || 0;
        const ePctTotal = eInflacion + eDolar + eOtros;
        const factorE = 1 + (ePctTotal / 100);
        const baseVFE = baseVF * factorE;

        const dAdminPct = Number(params.dAdminPct) || 0;
        const factorD = 1 + (dAdminPct / 100);
        const pv = baseVFE * factorD;

        return {
            historia: {
                gif,
                mo,
                totalCostos,
                ventasHistoricas,
                utilidadBruta,
                admon,
                venta,
                distrib,
                totalGastosOp,
                uai,
                isr,
                ptu,
                tasaISR,
                tasaPTU,
                utilidadNeta
            },
            formula: {
                V: ventasHistoricas,
                fAjuste,
                fCambio,
                fCrecimiento,
                fNeto,
                baseVF,
                eInflacion,
                eDolar,
                eOtros,
                ePctTotal,
                factorE,
                baseVFE,
                dAdminPct,
                factorD,
                pv
            }
        };
    }
}
