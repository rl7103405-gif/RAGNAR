/**
 * Cloud Functions de RAGNAR.
 *
 * Hoy solo hay una: el buzon HTTPS por el que el "Sincronizador SICAP" de
 * Atalanta deja los folios de ruteo que hasta ahora subia America a mano en
 * un Excel. Ver ruteo.js para el detalle y los porques.
 *
 * Despliegue:
 *   cd functions && npm install
 *   firebase deploy --only functions
 */
const { initializeApp } = require('firebase-admin/app')

initializeApp()

const ruteo = require('./ruteo')
exports.ruteoImport = ruteo.ruteoImport
