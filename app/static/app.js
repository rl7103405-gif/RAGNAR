async function llamarApi(url, opciones = {}) {
    const respuesta = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opciones,
    });
    let datos = null;
    try {
        datos = await respuesta.json();
    } catch (e) {
        datos = null;
    }
    if (!respuesta.ok) {
        let detalle = datos && datos.detail ? datos.detail : "Error inesperado";
        if (Array.isArray(detalle)) {
            detalle = detalle.map((error) => error.msg || "Dato inválido").join("; ");
        } else if (typeof detalle !== "string") {
            detalle = "Error inesperado";
        }
        throw new Error(detalle);
    }
    return datos;
}

// Escapa texto que viene de datos capturados antes de insertarlo con innerHTML,
// para que un valor con < > & " ' no se interprete como HTML.
function esc(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

function mostrarMensaje(contenedorId, texto, tipo) {
    const el = document.getElementById(contenedorId);
    if (!el) return;
    el.textContent = texto;
    el.className = "mensaje " + tipo;
    el.style.display = "block";
}

function ocultarMensaje(contenedorId) {
    const el = document.getElementById(contenedorId);
    if (el) el.style.display = "none";
}

function enfocarFolio() {
    const campo = document.getElementById("campo-folio");
    if (campo) campo.focus();
}

document.addEventListener("DOMContentLoaded", enfocarFolio);
window.addEventListener("focus", enfocarFolio);

// El sistema guarda y transmite TODOS los pesos en gramos (unidad interna);
// al usuario siempre se le muestran en kilogramos. Estas dos funciones son el
// único punto de conversión para display — no convertir "a mano" en las vistas.
function kgTexto(gramos) {
    if (gramos === null || gramos === undefined || !Number.isFinite(gramos)) return "-";
    return (gramos / 1000).toFixed(2);
}

function formatearKg(gramos) {
    const texto = kgTexto(gramos);
    return texto === "-" ? "-" : texto + " kg";
}

// Lee el peso desde el bridge local de la báscula (corre en localhost:8001 en esta misma PC).
async function leerPesoBascula() {
    const respuesta = await fetch("http://localhost:8001/peso");
    if (!respuesta.ok) throw new Error("No se pudo leer la báscula");
    return respuesta.json();
}
