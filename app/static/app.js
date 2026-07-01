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
        const detalle = datos && datos.detail ? datos.detail : "Error inesperado";
        throw new Error(detalle);
    }
    return datos;
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

// Lee el peso desde el bridge local de la bascula (corre en localhost:8001 en esta misma PC).
async function leerPesoBascula() {
    const respuesta = await fetch("http://localhost:8001/peso");
    if (!respuesta.ok) throw new Error("No se pudo leer la bascula");
    return respuesta.json();
}
